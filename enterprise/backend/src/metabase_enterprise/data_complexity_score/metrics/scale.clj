(ns metabase-enterprise.data-complexity-score.metrics.scale
  "Scale dimension — raw size of the catalog. Polarity is neutral: a bigger instance is not a worse
   instance, but bigger still drives agent difficulty by expanding the choice space. Every other
   dimension's density variable normalizes against these counts.

   Variables:
     :entity-count         (scored)  count of entities in the catalog
     :field-count          (scored)  sum of active fields across tables
     :collection-tree-size (scored)  count of collections in the catalog scope
     :fields-per-entity    (value)   derived — field-count / entity-count
     :measure-to-dim-ratio (value)   derived — named-measure density relative to fields

  All variables in this namespace are tier 1 (cheap, DB-only, no embeddings)."
  (:require
   [metabase-enterprise.data-complexity-score.metrics.common :as common]))

(set! *warn-on-reflection* true)

(def weights
  "Per-variable weights contributing to the dimension sub-total."
  {:entity-count         10
   :field-count          1
   :collection-tree-size 1})

(defn- entity-count [n]
  (common/scored (:entity-count weights) n))

(defn- field-count [total-fields]
  (common/scored (:field-count weights) total-fields))

(defn- collection-tree-size [collection-count]
  (common/scored (:collection-tree-size weights) (or collection-count 0)))

(defn- fields-per-entity [n total-fields]
  (common/value (common/safe-ratio total-fields n)))

(defn- measure-to-dim-ratio
  "`(count(named-measures) + count(metric-cards)) / count(fields)`.
   Captures how densely a catalog is curated as a semantic layer (intentional named metrics) vs.
   thin wrappers over raw data. nil when there are no fields to divide against."
  [entities total-fields]
  (let [measures     (reduce + 0 (map #(count (:measure-names %)) entities))
        metric-cards (count (filter #(= :metric (:kind %)) entities))]
    (common/value (common/safe-ratio (+ measures metric-cards) total-fields))))

(defn score
  "Compute the Scale dimension block given a catalog's `entities` and `ctx` (`:collection-count`).
  Pre-aggregates `n` and `total-fields` once and threads them through the per-variable helpers
  so a single walk of `entities` powers `entity-count`, `field-count`, `fields-per-entity`, and
  `measure-to-dim-ratio` instead of re-reducing for each."
  [entities {:keys [collection-count]}]
  (let [n            (count entities)
        total-fields (reduce + 0 (map #(or (:field-count %) 0) entities))]
    (common/dimension-block
     [[:entity-count         (entity-count n)]
      [:field-count          (field-count total-fields)]
      [:collection-tree-size (collection-tree-size collection-count)]
      [:fields-per-entity    (fields-per-entity n total-fields)]
      [:measure-to-dim-ratio (measure-to-dim-ratio entities total-fields)]])))
