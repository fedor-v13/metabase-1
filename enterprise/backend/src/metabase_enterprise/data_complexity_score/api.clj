(ns metabase-enterprise.data-complexity-score.api
  "Admin-only HTTP endpoint exposing the Data Complexity Score."
  (:require
   [metabase-enterprise.data-complexity-score.complexity :as complexity]
   [metabase-enterprise.data-complexity-score.metabot-scope :as metabot-scope]
   [metabase-enterprise.data-complexity-score.models.data-complexity-score :as data-complexity-score]
   [metabase-enterprise.data-complexity-score.settings :as settings]
   [metabase-enterprise.data-complexity-score.synonym-source :as synonym-source]
   [metabase-enterprise.data-complexity-score.task.complexity-score :as task.complexity-score]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.api.routes.common :refer [+auth]]
   [metabase.util :as m.util]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

;;; ----------------------------- variable-level schemas -----------------------------
;;;
;;; Variables come in two flavours:
;;;   - scored       `{:value <num> :score <num>}`           contributes to a dimension sub-total
;;;   - descriptive  `{:value <scalar-or-nil>}`              doesn't contribute
;;; `:value` may be nil (undefined ratio) or a richer structure (see DegreeSummary below).
;;;
;;; The complexity engine emits kebab-case internally; `m.util/deep-snake-keys` rewrites the
;;; payload at the API boundary so the schemas below describe the snake_case shape the client
;;; actually receives.

(def ^:private ScoredVar
  [:map
   [:value  [:maybe number?]]
   [:score  number?]
   [:error  {:optional true} string?]])

(def ^:private ValueVar
  [:map
   [:value [:maybe some?]]])

(def ^:private DegreeSummary
  [:map
   [:p50 nat-int?]
   [:p90 nat-int?]
   [:max nat-int?]])

(def ^:private DegreeSummaryVar
  [:map
   [:value DegreeSummary]])

;;; ------------------------------ dimension schemas --------------------------------

(def ^:private ScaleDim
  [:map
   [:variables
    [:map
     [:entity_count         ScoredVar]
     [:field_count          ScoredVar]
     [:collection_tree_size ScoredVar]
     [:fields_per_entity    ValueVar]
     [:measure_to_dim_ratio ValueVar]]]
   [:sub_total number?]])

(def ^:private NominalDim
  [:map
   [:variables
    [:map
     [:name_collisions         ScoredVar]
     [:repeated_measures       ScoredVar]
     [:field_level_collisions  ScoredVar]
     [:name_collisions_density ValueVar]
     [:name_concentration      ValueVar]]]
   [:sub_total number?]])

(def ^:private SemanticDim
  [:map
   [:variables
    [:map
     [:synonym_pairs              ScoredVar]
     [:synonym_edge_density       ValueVar]
     [:synonym_components         ValueVar]
     [:synonym_largest_component  ValueVar]
     [:synonym_avg_component      ValueVar]
     [:synonym_clustering_coef    ValueVar]
     [:synonym_avg_degree         ValueVar]
     [:synonym_degree_summary     DegreeSummaryVar]]]
   [:sub_total number?]])

(def ^:private MetadataDim
  [:map
   [:variables
    [:map
     [:description_coverage       ValueVar]
     [:field_description_coverage ValueVar]
     [:semantic_type_coverage     ValueVar]
     [:curated_metric_coverage    ValueVar]
     [:embedding_coverage         ValueVar]
     [:description_quality        ValueVar]]]
   [:coverage [:maybe number?]]])

(def ^:private Dimensions
  "All dimensions optional — level 0 omits everything, level 1 omits `:semantic`."
  [:map
   [:scale    {:optional true} ScaleDim]
   [:nominal  {:optional true} NominalDim]
   [:semantic {:optional true} SemanticDim]
   [:metadata {:optional true} MetadataDim]])

(def ^:private Catalog
  [:map
   [:dimensions Dimensions]
   [:total      number?]])

(def ^:private EmbeddingModelMeta
  "Identifies the embedding model backing the synonym calculations, so benchmark consumers can pin
  to it. Absent from `:meta` when the synonym axis wasn't computed (level 0 / 1)."
  [:maybe
   [:map
    [:provider         string?]
    [:model_name       string?]
    [:model_dimensions {:optional true} pos-int?]]])

(def ^:private ComplexityScoresResponse
  "Full response body for `GET /api/ee/data-complexity-score/complexity`."
  [:map
   [:library  Catalog]
   [:universe Catalog]
   [:metabot  Catalog]
   [:meta
    [:map
     [:formula_version   pos-int?]
     [:level             nat-int?]
     [:synonym_threshold {:optional true} number?]
     [:embedding_model   {:optional true} EmbeddingModelMeta]
     [:text_variant      {:optional true} keyword?]
     [:calculated_at     {:optional true} some?]]]])

;; Per-JVM single-flight guard for the /complexity endpoint. Each scoring run walks the entire
;; app-db catalog and emits Snowplow events, so concurrent superuser requests on the same node
;; would just multiply load and noise without producing different results — fast-fail with 409
;; instead. In a clustered deployment the guard is per-node, so up to one pass per node can still
;; run concurrently; we accept that since superuser API traffic is low-volume. The Quartz job
;; already has its own concurrency control (`DisallowConcurrentExecution` + cluster lock for boot
;; emission), so we deliberately don't share this guard with the task path; a daily cron run that
;; coincided with an API call shouldn't be cancelled.
(defonce ^:private ^java.util.concurrent.atomic.AtomicBoolean api-scoring-running?
  (java.util.concurrent.atomic.AtomicBoolean. false))

(defn- force-recalculate-score!
  "Run the Data Complexity Score job now, persist the fresh snapshot, and return it.
  This is expensive and emits Snowplow events for benchmark consumers. Concurrent requests
  on the same JVM fast-fail with HTTP 409 — a scoring pass walks the full app-db catalog
  and one in-flight run per node is enough. The guard is per-JVM, so in a clustered
  deployment each node can still run one pass concurrently."
  []
  (when-not (.compareAndSet api-scoring-running? false true)
    (throw (ex-info "Data Complexity Score calculation already in progress" {:status-code 409})))
  (try
    (let [fingerprint (task.complexity-score/current-fingerprint)
          result      (complexity/complexity-scores
                       (assoc (synonym-source/complexity-scores-opts)
                              :metabot-scope (metabot-scope/internal-metabot-scope)))
          stored      (data-complexity-score/record-score! fingerprint result)]
      ;; Advance the last-published fingerprint iff Snowplow actually accepted the event — mirrors
      ;; the scheduled path's gate in `task.complexity-score/run-scoring!`. Without this, a
      ;; superuser-triggered recalculation leaves the setting stale and the next boot would
      ;; redundantly re-score even though a valid snapshot was just persisted.
      (when (::complexity/snowplow-published? (meta result))
        (settings/data-complexity-scoring-last-fingerprint! fingerprint))
      (m.util/deep-snake-keys (or stored result)))
    (finally
      (.set api-scoring-running? false))))

(api.macros/defendpoint :get "/complexity" :- ComplexityScoresResponse
  "Return the most recently stored Data Complexity Score for this instance.
  Pass `force-recalculation=true` to recompute, persist, and return a fresh score.
  Superuser-only."
  [_route
   {force-recalculation? :force-recalculation} :- [:map
                                                   [:force-recalculation {:default false} ms/BooleanValue]]
   _body]
  (api/check-superuser)
  (if force-recalculation?
    (force-recalculate-score!)
    (api/check-404 (some-> (data-complexity-score/latest-score (task.complexity-score/current-fingerprint))
                           m.util/deep-snake-keys)
                   (tru "Data Complexity Score has not been computed yet. Recompute it to create the first snapshot."))))

(def ^{:arglists '([request respond raise])} routes
  "`/api/ee/data-complexity-score` routes."
  (api.macros/ns-handler *ns* +auth))
