(ns metabase-enterprise.data-complexity-score.api
  "Admin-only HTTP endpoint exposing the data complexity score."
  (:require
   [metabase-enterprise.data-complexity-score.complexity :as complexity]
   [metabase-enterprise.data-complexity-score.metabot-scope :as metabot-scope]
   [metabase-enterprise.data-complexity-score.synonym-source :as synonym-source]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.api.routes.common :refer [+auth]]))

(set! *warn-on-reflection* true)

;;; ----------------------------- variable-level schemas -----------------------------
;;;
;;; Variables come in two flavours:
;;;   - scored       `{:value <num> :score <num>}`           contributes to a dimension sub-total
;;;   - descriptive  `{:value <scalar-or-nil>}`              doesn't contribute
;;; `:value` may be nil (undefined ratio) or a richer structure (see DegreeSummary below).

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
     [:entity-count         ScoredVar]
     [:field-count          ScoredVar]
     [:collection-tree-size ScoredVar]
     [:fields-per-entity    ValueVar]
     [:measure-to-dim-ratio ValueVar]]]
   [:sub-total number?]])

(def ^:private NominalDim
  [:map
   [:variables
    [:map
     [:name-collisions         ScoredVar]
     [:repeated-measures       ScoredVar]
     [:field-level-collisions  ScoredVar]
     [:name-collisions-density ValueVar]
     [:name-concentration      ValueVar]]]
   [:sub-total number?]])

(def ^:private SemanticDim
  [:map
   [:variables
    [:map
     [:synonym-pairs              ScoredVar]
     [:synonym-edge-density       ValueVar]
     [:synonym-components         ValueVar]
     [:synonym-largest-component  ValueVar]
     [:synonym-avg-component      ValueVar]
     [:synonym-clustering-coef    ValueVar]
     [:synonym-avg-degree         ValueVar]
     [:synonym-degree-summary     DegreeSummaryVar]]]
   [:sub-total number?]])

(def ^:private MetadataDim
  [:map
   [:variables
    [:map
     [:description-coverage       ValueVar]
     [:field-description-coverage ValueVar]
     [:semantic-type-coverage     ValueVar]
     [:curated-metric-coverage    ValueVar]
     [:embedding-coverage         ValueVar]
     [:description-quality        ValueVar]]]
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
  to it. `nil` when the search-index path is in use and semantic search has not been configured."
  [:maybe
   [:map
    [:provider         string?]
    [:model-name       string?]
    [:model-dimensions {:optional true} pos-int?]]])

(def ^:private ComplexityScoresResponse
  [:map
   [:library  Catalog]
   [:universe Catalog]
   [:metabot  Catalog]
   [:meta
    [:map
     [:formula-version   pos-int?]
     [:level             nat-int?]
     [:synonym-threshold {:optional true} number?]
     [:embedding-model   {:optional true} EmbeddingModelMeta]
     [:text-variant      {:optional true} keyword?]]]])

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

(api.macros/defendpoint :get "/complexity" :- ComplexityScoresResponse
  "Return the current data complexity score for this instance.
  Superuser-only, expensive, and emits Snowplow events for benchmark consumers. Concurrent
  requests on the same JVM fast-fail with HTTP 409 — a scoring pass walks the full app-db
  catalog and one in-flight run per node is enough."
  [_route _query _body]
  (api/check-superuser)
  (when-not (.compareAndSet api-scoring-running? false true)
    (throw (ex-info "Data Complexity Score calculation already in progress" {:status-code 409})))
  (try
    (complexity/complexity-scores
     (assoc (synonym-source/complexity-scores-opts)
            :metabot-scope (metabot-scope/internal-metabot-scope)))
    (finally
      (.set api-scoring-running? false))))

(def ^{:arglists '([request respond raise])} routes
  "`/api/ee/data-complexity-score` routes."
  (api.macros/ns-handler *ns* +auth))
