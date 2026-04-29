(ns metabase-enterprise.data-complexity-score.complexity
  "Computes a multi-dimensional complexity score for the semantic layer of this Metabase instance.

  Three catalogs are scored:

    :library  — the curated subset (Cards of type :model and :metric)
    :universe — everything (library entities + all active physical tables)
    :metabot  — what the internal Metabot can actually surface. Identical to :universe unless the
                caller passes `:metabot-scope {:verified-only? <bool> :collection-id <nil|Long>}`
                describing how the internal Metabot filters retrieval. The caller owns the
                decision — this namespace does not read settings, premium-feature gates, or
                Metabot rows directly.

  Five dimensions are reported:

    :scale       size of the catalog (neutral polarity — bigger ≠ worse, but still drives choice-
                 space difficulty)
    :nominal     string-level naming disorder (collisions + density + concentration)
    :semantic    embedding-level disambiguation (graph analytics over a 0.80-similarity graph,
                 MiniLM-L6-v2 STS vectors on names-split text)
    :structural  (not yet implemented — deferred to tier 3)
    :metadata    positive-polarity coverage of descriptions / semantic_types / measures — NOT
                 summed into the aggregate total; reported alongside as a `:coverage` ratio

  Cost is controlled by a tier level (see `settings/semantic-complexity-level`): level 1 is cheap
  DB-only; level 2 adds the semantic graph (embeds names via ollama/MiniLM on every run — the
  search index's Arctic vectors are no longer reused); level ≥ 3 will add structural once
  implemented.

  Per-dimension math lives in `metrics/*` namespaces. This file owns enumeration, scope resolution,
  Snowplow emission, and the top-level coordination between dimensions."
  (:require
   [clojure.pprint :as pprint]
   [metabase-enterprise.data-complexity-score.metrics.metadata :as metrics.metadata]
   [metabase-enterprise.data-complexity-score.metrics.nominal :as metrics.nominal]
   [metabase-enterprise.data-complexity-score.metrics.scale :as metrics.scale]
   [metabase-enterprise.data-complexity-score.metrics.semantic :as metrics.semantic]
   [metabase-enterprise.data-complexity-score.settings :as settings]
   [metabase.analytics-interface.core :as analytics.interface]
   [metabase.analytics.core :as analytics]
   [metabase.audit-app.core :as audit]
   [metabase.collections.core :as collections]
   [metabase.util :as u]
   [metabase.util.log :as log]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def formula-version
  "Bump when the scoring formula changes in a way that breaks historical comparisons.
  Swaps of `embedding-model`, `synonym-threshold`, or `text-variant` don't need a bump — they
  already ride in the fingerprint + `:meta` + Snowplow parameters, so downstream readers can
  diff on those fields directly."
  1)

;;; ----------------------------------- enumeration -----------------------------------

(defn- table-fields
  "`{table-id [{:name :semantic-type :description} ...]}` for active fields on the given
   `table-ids`. One query, no chatter."
  [table-ids]
  (if (empty? table-ids)
    {}
    (->> (t2/query {:select [:table_id :name :semantic_type :description]
                    :from   [:metabase_field]
                    :where  [:and
                             [:= :active true]
                             [:in :table_id table-ids]]})
         (reduce (fn [acc {:keys [table_id name semantic_type description]}]
                   (update acc table_id (fnil conj [])
                           {:name name :semantic-type semantic_type :description description}))
                 {}))))

(defn- table-measure-names
  "`{table-id [measure-name ...]}` for non-archived Measures on `table-ids`."
  [table-ids]
  (if (empty? table-ids)
    {}
    (->> (t2/select [:model/Measure :table_id :name]
                    :archived false
                    :table_id [:in table-ids])
         (reduce (fn [acc {:keys [table_id name]}]
                   (update acc table_id (fnil conj []) name))
                 {}))))

(defn- ->card-entity
  "Cards contribute 0 to `:field-count` / `:fields` and have no attached Measures — fields live on
   Tables, and the Measure model is Table-keyed. We keep the result-metadata column out of the
   reducible-select query so Card-heavy instances don't balloon per-row footprint."
  [{:keys [id name type description]}]
  {:id            id
   :name          name
   :kind          (keyword type)
   :description   description
   :field-count   0
   :fields        []
   :measure-names []})

(defn- ->table-entity [fields-by-table measure-names {:keys [id name description]}]
  (let [fields (get fields-by-table id [])]
    {:id            id
     :name          name
     :kind          :table
     :description   description
     :field-count   (count fields)
     :fields        fields
     :measure-names (get measure-names id [])}))

(defn- library-collection-ids
  "Set of collection IDs that make up the Library (root + descendants). Empty set when the
   instance has no Library yet."
  []
  (into #{}
        (when-let [root (collections/library-collection)]
          (cons (:id root) (collections/descendant-ids root)))))

(defn- collect-card-entities
  [filter-kvs]
  (into []
        (map ->card-entity)
        (apply t2/reducible-select
               [:model/Card :id :name :type :description :card_schema]
               filter-kvs)))

(defn- assemble-table-entities [tables]
  (let [table-ids     (mapv :id tables)
        fields-by-tbl (table-fields table-ids)
        measure-names (table-measure-names table-ids)]
    (mapv #(->table-entity fields-by-tbl measure-names %) tables)))

(defn- universe-collection-count
  "Non-archived, non-personal collections. Personal collections are per-user and excluded from
   the shared catalog view; archived collections aren't navigable. Audit-DB filtering happens on
   the entity side (by `database_id`), not here — collections don't have a `database_id` column."
  []
  (or (t2/count :model/Collection :archived false :personal_owner_id nil) 0))

(defn library-catalog
  "Library catalog enumeration — non-archived metric/model Cards and published Tables inside the
   Library collection tree, plus the count of collections in that tree. Audit-DB content is
   filtered out so library remains a strict subset of universe even when audit-db rows happen
   to be parented by a Library collection."
  []
  (let [coll-ids (library-collection-ids)]
    (if (empty? coll-ids)
      {:entities [] :collection-count 0}
      (let [cards  (collect-card-entities [:type          [:in ["metric" "model"]]
                                           :archived      false
                                           :collection_id [:in coll-ids]
                                           :database_id   [:not= audit/audit-db-id]])
            tables (t2/select [:model/Table :id :name :description]
                              :active        true
                              :is_published  true
                              :collection_id [:in coll-ids]
                              :db_id         [:not= audit/audit-db-id])]
        {:entities         (into cards (assemble-table-entities tables))
         :collection-count (count coll-ids)}))))

(defn universe-catalog
  "Universe catalog enumeration — every non-archived metric/model Card and every active physical
   Table on this instance (excluding audit content), plus the catalog-wide collection count."
  []
  (let [cards  (collect-card-entities [:type        [:in ["metric" "model"]]
                                       :archived    false
                                       :database_id [:not= audit/audit-db-id]])
        tables (t2/select [:model/Table :id :name :description]
                          :active true
                          :db_id  [:not= audit/audit-db-id])]
    {:entities         (into cards (assemble-table-entities tables))
     :collection-count (universe-collection-count)}))

(defn- metabot-collection-scope-ids
  "Collection IDs the internal Metabot can see — its `collection_id` plus descendants. nil when
   no collection scope is configured. Even if the collection row can't be loaded (stale id), we
   still return a singleton set with the raw id so the catalog matches
   `metabot-metrics-and-models-query`, which filters on the raw `collection_id` and returns an
   empty result rather than dropping the filter."
  [collection-id]
  (when collection-id
    (into #{collection-id}
          (when-let [root (t2/select-one :model/Collection :id collection-id)]
            (collections/descendant-ids root)))))

(defn- metabot-card-entities
  "Cards the internal Metabot would actually surface, optionally restricted to a collection
   subtree and/or to verified-moderation Cards. Mirrors the filters in
   `metabase.metabot.tools.util/metabot-metrics-and-models-query`."
  [{:keys [verified-only? collection-id]}]
  (let [coll-ids (metabot-collection-scope-ids collection-id)
        where    (cond-> [:and
                          [:in :report_card.type [:inline ["metric" "model"]]]
                          [:= :report_card.archived false]
                          [:not= :report_card.database_id audit/audit-db-id]]
                   coll-ids       (conj [:in :report_card.collection_id coll-ids])
                   verified-only? (conj [:= :mr.status [:inline "verified"]]))
        query    (cond-> {:select [:report_card.id :report_card.name :report_card.type
                                   :report_card.description :report_card.card_schema]
                          :from   [[:report_card]]
                          :where  where}
                   verified-only? (assoc :left-join
                                         [[:moderation_review :mr]
                                          [:and
                                           [:= :mr.moderated_item_id :report_card.id]
                                           [:= :mr.moderated_item_type [:inline "card"]]
                                           [:= :mr.most_recent true]]]))]
    (into []
          (map ->card-entity)
          (t2/reducible-select :model/Card query))))

(defn- metabot-visible-tables
  "Tables Metabot/search can actually surface — active, non-hidden (`:visibility_type IS NULL`),
   on a non-routed database (`db.router_database_id IS NULL`), and outside the audit DB. Mirrors
   the table-visibility filters in `metabase.warehouse-schema.models.table` and
   `metabase.metabot.tools.util` so hidden / technical / routed-DB tables don't inflate the
   `:metabot` catalog."
  []
  (t2/select [:model/Table :id :name :description]
             {:select    [:metabase_table.id :metabase_table.name :metabase_table.description]
              :from      [:metabase_table]
              :left-join [[:metabase_database :db] [:= :db.id :metabase_table.db_id]]
              :where     [:and
                          [:= :metabase_table.active true]
                          [:= :metabase_table.visibility_type nil]
                          [:= :db.router_database_id nil]
                          [:not= :metabase_table.db_id audit/audit-db-id]]}))

(defn metabot-catalog
  "Metabot catalog when any Metabot retrieval scope is in effect (verified-only, a collection
   subtree, or both). Cards are filtered to match Metabot retrieval; Tables are filtered through
   [[metabot-visible-tables]] so hidden, technical, and routed-DB tables — which Metabot/search
   never surface — don't inflate the catalog. Collection count is the Metabot scope subtree when
   present, otherwise the full universe count."
  [scope]
  (let [card-entities (metabot-card-entities scope)
        tables        (metabot-visible-tables)
        coll-ids      (metabot-collection-scope-ids (:collection-id scope))]
    {:entities         (into card-entities (assemble-table-entities tables))
     :collection-count (or (some-> coll-ids count) (universe-collection-count))}))

;;; ------------------------------------- scoring -------------------------------------

(defn- catalog-total
  "Sum sub-totals across additive dimensions (everything except `:metadata`)."
  [dimensions]
  (reduce + 0 (keep :sub-total (vals (dissoc dimensions :metadata)))))

(defn score-catalog
  "Pure: compute the dimension breakdown for a catalog given its `entities`, a context map
  `{:collection-count <long>}`, an optional `embedder`, and an integer `level` (1 or 2 within
  this build). Returns `{:dimensions {...} :total <long>}`."
  [entities {:keys [collection-count]} embedder level]
  (let [scale-b      (when (>= ^long level 1)
                       (metrics.scale/score entities {:collection-count collection-count}))
        nominal-b    (when (>= ^long level 1)
                       (metrics.nominal/score entities))
        embedder-out (when (>= ^long level 2)
                       (metrics.semantic/embedder-result entities embedder))
        emb-cov      (when embedder-out
                       (metrics.semantic/embedding-coverage entities embedder-out))
        semantic-b   (when (>= ^long level 2)
                       (metrics.semantic/score entities embedder-out))
        metadata-b   (when (>= ^long level 1)
                       (metrics.metadata/score entities {:embedding-coverage emb-cov}))
        dimensions   (cond-> {}
                       scale-b    (assoc :scale scale-b)
                       nominal-b  (assoc :nominal nominal-b)
                       semantic-b (assoc :semantic semantic-b)
                       metadata-b (assoc :metadata metadata-b))]
    {:dimensions dimensions
     :total      (catalog-total dimensions)}))

;;; ----------------------------------- public API ------------------------------------

(defn- log-scores!
  "Write the computed result to application logs. Operators get this even when Snowplow isn't
   reachable, since scoring only runs at startup and on the superuser recompute endpoint."
  [result]
  (log/info (str "Semantic complexity score:\n"
                 #_{:clj-kondo/ignore [:discouraged-var]}
                 (with-out-str (pprint/pprint result)))))

(defn- snake ^String [x]
  (-> x name (.replace "-" "_")))

(defn- dotted-key
  "Identifier for a slice in the `data_complexity` schema's `:key` field — `\"total\"` at the
  catalog level, `\"<dimension>.<variable>\"` per leaf. Free-form string per the schema, so new
  variables can be added without a schema bump."
  ([] "total")
  ([dim var] (str (snake dim) "." (snake var))))

(defn- measurement-of
  "Publish the raw pre-score measurement alongside each variable event so downstream can track
   count/pairs without inverting the weight map."
  [var-map]
  (when-let [v (:value var-map)]
    (when (number? v) v)))

(def ^:private max-error-length
  "Matches the `data_complexity` Snowplow schema's `error` maxLength — a pathological exception
  message must not fail validation and drop the whole event."
  1024)

(defn- truncate-error [s]
  (cond-> s (< max-error-length (count s)) (subs 0 max-error-length)))

(defn- with-score
  "Attach `:score` to `event` only when it is non-nil.
  The `data_complexity` Snowplow schema flags `score` as non-nullable but optional, so an
  uncomputed sub-score (descriptive variables that carry only `:value`, or aggregates that
  cascaded nil from a failed leaf) must omit the key entirely rather than emit `\"score\": null`."
  [event score]
  (cond-> event (some? score) (assoc :score score)))

(defn- parameters-map
  "Sorted-map of scoring inputs likely to evolve, published as a JSON object on each event.
  String keys (top-level and nested) so they round-trip unchanged — Snowplow's `payload` only
  snake-cases top-level keys, and Cheshire would serialize nested keyword keys with their leading
  colon. `formula_version` stays top-level as the primary cross-version filter."
  [{:keys [level synonym-threshold embedding-model text-variant]}]
  (cond-> (sorted-map "level" level)
    synonym-threshold (assoc "synonym_threshold" synonym-threshold)
    embedding-model   (assoc "embedding_model_provider" (:provider embedding-model)
                             "embedding_model_name"     (:model-name embedding-model))
    text-variant      (assoc "text_variant" (snake text-variant))))

(defn- catalog-events
  "Build the Snowplow events for one catalog: a `key=\"total\"` event for the catalog total plus
  one `key=\"<dimension>.<variable>\"` event per leaf. Events conform to `data_complexity`
  schema 1-0-0."
  [catalog {:keys [dimensions total]} base]
  (cons (-> base
            (assoc :catalog catalog :key (dotted-key))
            (with-score total))
        (for [[dim {:keys [variables]}] dimensions
              [var-k var-map]           variables]
          (cond-> (-> base
                      (assoc :catalog catalog :key (dotted-key dim var-k))
                      (with-score (:score var-map)))
            (measurement-of var-map) (assoc :measurement (measurement-of var-map))
            (:error var-map)         (assoc :error (truncate-error (:error var-map)))))))

(defn- emit-snowplow!
  "Submit Snowplow events for every catalog total + per-variable leaf.
  Returns true only when every emission succeeded; false when tracking is disabled or any one
  failed. Continues attempting all events even after a failure so partial outages still log
  every attempt."
  [{:keys [library universe metabot meta]}]
  (let [base   {:event           :data_complexity_scoring
                :formula_version (:formula-version meta)
                :parameters      (parameters-map meta)}
        events (mapcat (fn [[catalog result]] (catalog-events catalog result base))
                       [[:library library] [:universe universe] [:metabot metabot]])]
    (reduce (fn [all-ok? event]
              (and (analytics/track-event! :snowplow/data_complexity event) all-ok?))
            true
            events)))

(defn- empty-score [] {:dimensions {} :total 0})

(defn score-from-entities
  "Pure: compute the full complexity score from pre-built entity vectors and an embedder.
  No DB access, no Snowplow emission.

  Options:
    `:level`                ceiling on which dimensions to compute; defaults to the setting
                            (`settings/effective-level`). Level 0 short-circuits — empty blocks
                            for every catalog and no embedder call.
    `:embedding-model-meta` optional `{:provider ... :model-name ...}` stashed into `:meta`.
    `:text-variant`         optional preprocessing variant (e.g. `:names-split`) stashed into
                            `:meta`. Together with `:embedding-model-meta`, pins how the
                            synonym-axis vectors were produced.
    `:metabot-catalog`      optional `{:entities [...] :collection-count N}` for the `:metabot`
                            catalog. When absent (default), `:metabot` reuses the universe score."
  [{lib-entities :entities lib-coll :collection-count :as _library-catalog}
   {uni-entities :entities uni-coll :collection-count :as _universe-catalog}
   embedder
   {:keys [level embedding-model-meta text-variant metabot-catalog]}]
  (let [level        (settings/clamp-level (or level (settings/semantic-complexity-level)))
        ;; At level 0 the embedder is never invoked, so we deliberately omit
        ;; `:embedding-model` / `:text-variant` even when the caller passed them — meta
        ;; advertising a synonym-axis configuration that wasn't used would mislead consumers.
        empty-result {:library  (empty-score)
                      :universe (empty-score)
                      :metabot  (empty-score)
                      :meta     {:formula-version formula-version :level 0}}]
    (if (zero? ^long level)
      empty-result
      (let [universe-score (score-catalog uni-entities {:collection-count uni-coll} embedder level)]
        {:library  (score-catalog lib-entities {:collection-count lib-coll} embedder level)
         :universe universe-score
         :metabot  (if metabot-catalog
                     (score-catalog (:entities metabot-catalog)
                                    {:collection-count (:collection-count metabot-catalog)}
                                    embedder
                                    level)
                     universe-score)
         :meta     (cond-> {:formula-version formula-version :level level}
                     (>= ^long level 2)
                     (assoc :synonym-threshold metrics.semantic/synonym-similarity-threshold)

                     (and (>= ^long level 2) embedding-model-meta)
                     (assoc :embedding-model embedding-model-meta)

                     (and (>= ^long level 2) text-variant)
                     (assoc :text-variant text-variant))}))))

(defn- metabot-scope-applies? [{:keys [verified-only? collection-id]}]
  (or (boolean verified-only?) (some? collection-id)))

(defn- time-phase!
  "Run `f`, record duration on the per-phase histogram labelled by `stage` and `catalog`, return its value."
  [stage catalog f]
  (let [timer (u/start-timer)]
    (try
      (f)
      (finally
        (analytics.interface/observe! :metabase-data-complexity/phase-duration-ms
                                      {:stage stage :catalog catalog}
                                      (u/since-ms timer))))))

(defn complexity-scores
  "Compute the complexity score for the `:library`, `:universe`, and `:metabot` catalogs.

  Returns

    {:library {:dimensions {:scale {...} :nominal {...} :semantic {...} :metadata {...}}
               :total <long>}
     :universe {…}
     :metabot  {…}
     :meta     {:formula-version 1
                :level <int>
                :synonym-threshold <float>
                :embedding-model {:provider ... :model-name ...}
                :text-variant :names-split}}

  Pure: this fn does not read settings or feature flags. Callers (api / task) resolve the
  synonym-axis source via [[metabase-enterprise.data-complexity-score.synonym-source]] and pass
  the result here.

  Options:
    `:embedder`             — synonym-axis embedder. `nil` (or unset) disables synonym scoring.
    `:embedding-model-meta` — `{:provider :model-name :model-dimensions}` published into
                              `:meta.embedding-model`. Pass nil to omit.
    `:text-variant`         — preprocessing variant published into `:meta.text-variant`. Pass nil
                              to omit (the search-index path passes nil because its preprocessing
                              isn't a single named variant).
    `:metabot-scope`        — `{:verified-only? <bool> :collection-id <nil|Long>}` describing how
                              the internal Metabot filters Cards.
    `:level`                — override the level setting for this call (rare; mainly for tests)."
  [& {:keys [embedder embedding-model-meta text-variant metabot-scope level]}]
  ;;; NOTE: we fully materialize vectors of the relevant entities.
  ;;; For very large instances that means holding large lists in memory, but each catalog is consumed
  ;;; by many sub-score functions that each walk the collection, so making this reducible would
  ;;; re-query the app-db five times per scoring call — a worse tradeoff than the bounded memory we
  ;;; currently consume.
  (let [total-timer (u/start-timer)
        level       (settings/clamp-level (or level (settings/semantic-complexity-level)))]
    (try
      (let [[library universe metabot]
            ;; Single enumerate phase. The level-0 short-circuit returns empty catalogs without
            ;; hitting the app-db at all; scoring is timed under a single `"all"` bucket too, so
            ;; one enumerate label and one score label is enough to attribute the whole run.
            (time-phase! "enumerate" "all"
                         #(if (zero? ^long level)
                            [{:entities [] :collection-count 0}
                             {:entities [] :collection-count 0}
                             nil]
                            [(library-catalog)
                             (universe-catalog)
                             (when (metabot-scope-applies? metabot-scope)
                               (metabot-catalog metabot-scope))]))
            result (time-phase! "score" "all"
                                #(score-from-entities library universe embedder
                                                      {:level                level
                                                       :embedding-model-meta embedding-model-meta
                                                       :text-variant         text-variant
                                                       :metabot-catalog      metabot}))]
        (log-scores! result)
        (let [published? (time-phase! "publish" "all"
                                      (fn []
                                        (try
                                          (emit-snowplow! result)
                                          (catch Throwable t
                                            (log/warn t "Failed to publish complexity score to Snowplow")
                                            false))))]
          ;; `emit-snowplow!` returns true only when every event reached the tracker (false when
          ;; Snowplow is disabled or any emission failed) — scheduler/boot callers gate
          ;; `data-complexity-scoring-last-fingerprint` on this so a disabled collector or any
          ;; partial failure doesn't silently mark the fingerprint as published.
          (with-meta result {::snowplow-published? published?})))
      (finally
        (analytics.interface/observe! :metabase-data-complexity/scoring-duration-ms
                                      (u/since-ms total-timer))))))

(comment
  (complexity-scores))
