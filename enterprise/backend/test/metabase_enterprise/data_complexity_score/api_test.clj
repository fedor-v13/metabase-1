(ns metabase-enterprise.data-complexity-score.api-test
  (:require
   [clojure.test :refer :all]
   [metabase-enterprise.data-complexity-score.api :as api]
   [metabase-enterprise.data-complexity-score.complexity :as complexity]
   [metabase-enterprise.data-complexity-score.complexity-embedders :as embedders]
   [metabase-enterprise.data-complexity-score.metabot-scope :as metabot-scope]
   [metabase-enterprise.data-complexity-score.models.data-complexity-score :as data-complexity-score]
   [metabase-enterprise.data-complexity-score.settings :as data-complexity-score.settings]
   [metabase-enterprise.data-complexity-score.synonym-source :as synonym-source]
   [metabase-enterprise.data-complexity-score.task.complexity-score :as task.complexity-score]
   [metabase.metabot.config :as metabot.config]
   [metabase.test :as mt]
   [metabase.util :as m.util]
   [toucan2.core :as t2])
  (:import
   (java.util.concurrent CountDownLatch TimeUnit)))

(set! *warn-on-reflection* true)

(comment api/keep-me)

(def ^:private endpoint "ee/data-complexity-score/complexity")

(defn- random-vec-for-name
  "Deterministic 8-dim Gaussian vector seeded by the name's hash. Same name always returns the
  same vector across catalogs, so library ⊆ universe synonym pairs holds; different names produce
  visibly different vectors, so the synonym axis exercises real cosine work instead of collapsing
  to zero."
  ^floats [^String n]
  (let [rng (java.util.Random. (long (hash n)))]
    (float-array (repeatedly 8 #(.nextGaussian rng)))))

(def ^:private random-synonym-embedder
  (embedders/fn-embedder #(mapv random-vec-for-name %)))

(def ^:private additive-dims [:scale :nominal :semantic])

(defn- var-value
  "Reach into the (snake_case) response and pull the `:value` field from a variable. The response
  is schema-coerced via `m.util/deep-snake-keys`, so test code reads snake_case keys throughout."
  [resp catalog dim k]
  (get-in resp [catalog :dimensions dim :variables k :value]))

(defn- entity-count [resp catalog]
  (var-value resp catalog :scale :entity_count))

(defn- internal-metabot-id
  "Primary key of the internal Metabot row — used by the tests that temporarily tweak its
   `use_verified_content`/`collection_id` via `mt/with-temp-vals-in-db`. Calls
   `mt/initialize-if-needed!` so the row is populated by migrations even when this test runs in
   isolation (the endpoint tests piggyback on the web-server init and miss this failure mode)."
  []
  (mt/initialize-if-needed! :db)
  (t2/select-one-pk :model/Metabot
                    :entity_id (get-in metabot.config/metabot-config
                                       [metabot.config/internal-metabot-id :entity-id])))

;;; ----------------------------- shared sample / stub scores ----------------------------------
;;;
;;; Internal kebab-case shape (what `complexity/complexity-scores` returns and what
;;; `data-complexity-score/latest-score` reads back from the JSON column). The endpoint applies
;;; `m.util/deep-snake-keys` before coercing to the response schema, so tests that compare against
;;; the HTTP response wrap the expected value with `m.util/deep-snake-keys`.

(defn- scored-var [v s] {:value v :score s})
(def ^:private descriptive-var {:value nil})

(def ^:private empty-scale-vars
  {:entity-count         (scored-var 0 0)
   :field-count          (scored-var 0 0)
   :collection-tree-size (scored-var 0 0)
   :fields-per-entity    descriptive-var
   :measure-to-dim-ratio descriptive-var})

(def ^:private empty-nominal-vars
  {:name-collisions         (scored-var 0 0)
   :repeated-measures       (scored-var 0 0)
   :field-level-collisions  (scored-var 0 0)
   :name-collisions-density descriptive-var
   :name-concentration      descriptive-var})

(def ^:private empty-catalog
  "Level-1 shaped catalog (no `:semantic`, no `:metadata`) — enough variables to satisfy the
  endpoint schema while keeping the fixture short."
  {:dimensions {:scale   {:variables empty-scale-vars   :sub-total 0}
                :nominal {:variables empty-nominal-vars :sub-total 0}}
   :total      0})

(def ^:private stub-scores
  "Minimum-shape result `complexity-scores` must return — passes the endpoint's response schema so
  tests that don't care about the actual numbers (concurrency, fingerprint advancement, …) can
  stub `complexity-scores` without rebuilding the whole dimension fixture."
  {:library empty-catalog :universe empty-catalog :metabot empty-catalog
   :meta    {:formula-version complexity/formula-version :level 1}})

(defn- scaled-catalog
  "Shape a sample catalog with the given entity- and field-counts. Lets persistence-flow tests
  assert on a non-trivial total without hand-rolling a full dimension map per test."
  [entity-count field-count repeated-measures]
  (let [scale-total (+ (* entity-count 10) (* field-count 1))
        nominal-total (* repeated-measures 2)]
    {:dimensions {:scale   {:variables (assoc empty-scale-vars
                                              :entity-count (scored-var entity-count (* entity-count 10))
                                              :field-count  (scored-var field-count  field-count))
                            :sub-total scale-total}
                  :nominal {:variables (assoc empty-nominal-vars
                                              :repeated-measures (scored-var repeated-measures nominal-total))
                            :sub-total nominal-total}}
     :total      (+ scale-total nominal-total)}))

(def ^:private sample-score
  {:library  (scaled-catalog 1 8 0)
   :universe (scaled-catalog 2 24 5)
   :metabot  (scaled-catalog 1 20 0)
   :meta     {:formula-version complexity/formula-version :level 1}})

(def ^:private sample-calculated-at "2026-04-23T12:00:00Z")

(defn- with-sample-calculated-at
  [score]
  (assoc-in score [:meta :calculated-at] sample-calculated-at))

;;; ---------------------------------- tests ----------------------------------------

(deftest complexity-endpoint-requires-superuser-test
  (testing "non-superusers are rejected"
    (is (= "You don't have permissions to do that."
           (mt/user-http-request :rasta :get 403 endpoint)))))

(deftest complexity-endpoint-force-recalculation-requires-superuser-test
  (testing "non-superusers cannot trigger a forced recomputation"
    (is (= "You don't have permissions to do that."
           (mt/user-http-request :rasta :get 403 endpoint :force-recalculation true)))))

(deftest complexity-endpoint-returns-latest-stored-score-test
  (testing "superusers read the latest persisted score snapshot instead of recomputing it on demand"
    (let [captured-fingerprint (atom nil)]
      (mt/with-dynamic-fn-redefs [task.complexity-score/current-fingerprint (constantly "api-test-fp")
                                  data-complexity-score/latest-score
                                  (fn [fingerprint]
                                    (reset! captured-fingerprint fingerprint)
                                    (with-sample-calculated-at sample-score))]
        (let [resp (mt/user-http-request :crowberto :get 200 endpoint)]
          (is (= "api-test-fp" @captured-fingerprint))
          (is (= (m.util/deep-snake-keys (with-sample-calculated-at sample-score)) resp))
          (is (contains? (:meta resp) :formula_version))
          (is (= sample-calculated-at (get-in resp [:meta :calculated_at])))
          (is (not (contains? (:meta resp) :formula-version)))
          (is (contains? (get-in resp [:library :dimensions :scale :variables]) :entity_count))
          (is (not (contains? (get-in resp [:library :dimensions :scale :variables]) :entity-count))))))))

(deftest complexity-endpoint-404s-when-no-score-has-been-persisted-yet-test
  (testing "the endpoint 404s until the background scorer has produced its first snapshot"
    (mt/with-dynamic-fn-redefs [data-complexity-score/latest-score (constantly nil)]
      (is (= "Data Complexity Score has not been computed yet. Recompute it to create the first snapshot."
             (mt/user-http-request :crowberto :get 404 endpoint))))))

(deftest complexity-endpoint-force-recalculation-returns-fresh-score-test
  (testing "superusers can trigger the expensive recompute path on demand"
    (let [persisted? (atom nil)]
      (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                    task.complexity-score/current-fingerprint (constantly "api-test-fp")
                    complexity/complexity-scores              (fn [& _] sample-score)
                    data-complexity-score/record-score!       (fn [fingerprint stored-score]
                                                                (reset! persisted? [fingerprint stored-score])
                                                                (with-sample-calculated-at stored-score))]
        (is (= (m.util/deep-snake-keys (with-sample-calculated-at sample-score))
               (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)))
        (is (= ["api-test-fp" sample-score] @persisted?))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-advances-last-fingerprint-on-snowplow-publish-test
  (testing "force recalculation mirrors the scheduled path's fingerprint gate — advance only when Snowplow accepted the event"
    (mt/with-temporary-setting-values [data-complexity-scoring-last-fingerprint "stale"]
      (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                    task.complexity-score/current-fingerprint (constantly "refresh-fp")
                    data-complexity-score/record-score!       (fn [& _] nil)
                    complexity/complexity-scores
                    (fn [& _]
                      (with-meta sample-score
                                 {::complexity/snowplow-published? true}))]
        (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)
        (is (= "refresh-fp" (data-complexity-score.settings/data-complexity-scoring-last-fingerprint))
            "successful Snowplow publish must advance the last-fingerprint so the next boot doesn't redundantly re-score")))))

(deftest ^:sequential complexity-endpoint-force-recalculation-keeps-fingerprint-stale-when-snowplow-publish-fails-test
  (testing "force recalculation leaves the fingerprint stale when Snowplow didn't accept the event, so the next scheduled run retries"
    (mt/with-temporary-setting-values [data-complexity-scoring-last-fingerprint "stale"]
      (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                    task.complexity-score/current-fingerprint (constantly "refresh-fp")
                    data-complexity-score/record-score!       (fn [& _] nil)
                    complexity/complexity-scores
                    (fn [& _]
                      (with-meta sample-score
                                 {::complexity/snowplow-published? false}))]
        (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)
        (is (= "stale" (data-complexity-score.settings/data-complexity-scoring-last-fingerprint))
            "failed publish must preserve the stale fingerprint — same semantics as the scheduled path")))))

(deftest complexity-endpoint-force-recalculation-runs-when-scheduled-scoring-disabled-test
  (testing "manual force recalculation does not reuse the scheduled scorer's enabled gate"
    (mt/with-temporary-setting-values [data-complexity-scoring-enabled false]
      (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                    task.complexity-score/current-fingerprint (constantly "api-test-fp")
                    complexity/complexity-scores              (fn [& _] sample-score)
                    data-complexity-score/record-score!       (fn [& _] nil)]
        (is (= (m.util/deep-snake-keys sample-score)
               (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-superuser-gets-consistent-totals-test
  (testing "check invariants not covered by schema"
    ;; Stub the synonym-source's opts to a deterministic hash-seeded random vector lookup.
    ;; Returning {} would zero out the synonym axis and trivialize the invariants below; calling
    ;; the real ai-service would make this test depend on environments where it's unreachable.
    ;; Same name → same vector across catalogs preserves the library ⊆ universe pair invariant.
    (mt/with-dynamic-fn-redefs [synonym-source/complexity-scores-opts
                                (constantly {:embedder random-synonym-embedder})]
      (with-redefs [data-complexity-score/record-score! (fn [& _] nil)]
        (let [resp        (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)
              ;; Scored variables on the additive dimensions. Metadata variables are descriptive
              ;; coverage ratios and excluded — they can legitimately drop as a catalog widens
              ;; (e.g. universe pulls in uncurated tables), breaking the monotonicity invariant.
              ;;
              ;; NOTE: `:synonym_pairs` is intentionally included here even though it's
              ;; *theoretically* non-monotonic — the synonym-pair scorer dedupes by normalized name
              ;; and keeps whichever embedding the provider returns for that name, so adding
              ;; universe-only entities that collide on normalized name with a library entity could
              ;; in principle flip which vector wins and drop the pair count below library's.
              ;; Reviewers (human or AI) sometimes want to carve it out on that basis — don't. In
              ;; every realistic configuration the invariant holds, and asserting it keeps us
              ;; honest about regressions in the common case.
              scored-vars [[:scale    :entity_count]
                           [:scale    :field_count]
                           [:scale    :collection_tree_size]
                           [:nominal  :name_collisions]
                           [:nominal  :repeated_measures]
                           [:nominal  :field_level_collisions]
                           [:semantic :synonym_pairs]]]
          (testing ":total equals the sum of additive-dimension :sub_total values (metadata excluded)"
            (doseq [catalog [:library :universe :metabot]
                    :let [{:keys [total dimensions]} (get resp catalog)
                          add-totals (map (comp :sub_total dimensions) additive-dims)]]
              (is (= total (reduce + 0 (remove nil? add-totals)))
                  (format "%s :total should equal sum of additive dimension :sub_total values" catalog))))
          (testing "universe is a superset of library on every scored variable"
            (doseq [[dim k] scored-vars
                    metric  [:value :score]]
              (let [lib (get-in resp [:library  :dimensions dim :variables k metric])
                    uni (get-in resp [:universe :dimensions dim :variables k metric])]
                (when (and (number? lib) (number? uni))
                  (is (>= uni lib)
                      (format "universe %s %s %s (%s) should be ≥ library's (%s)"
                              dim k metric uni lib))))))
          (testing ":synonym_pairs can't exceed the number of distinct-name pairs possible"
            (doseq [catalog [:library :universe :metabot]
                    :let [n         (entity-count resp catalog)
                          syn-pairs (var-value resp catalog :semantic :synonym_pairs)
                          max-pairs (/ (* n (dec n)) 2)]]
              (is (<= syn-pairs max-pairs)
                  (format "%s :synonym_pairs (%d) can't exceed n*(n-1)/2 for n=%d" catalog syn-pairs n))))
          (testing "every catalog carries all four dimensions at the default level (2)"
            (doseq [catalog [:library :universe :metabot]]
              (is (= #{:scale :nominal :semantic :metadata}
                     (set (keys (get-in resp [catalog :dimensions])))))))
          (testing ":meta reports the current formula-version + level"
            (is (= complexity/formula-version (get-in resp [:meta :formula_version])))
            (is (number? (get-in resp [:meta :level])))))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-metabot-catalog-test
  (testing ":metabot matches :universe in size when no Metabot scope filters apply and the test
            instance has no hidden/routed-DB tables — the metabot catalog still runs through its
            visibility filter, but on this fixture those filters are no-ops"
    ;; Pin both gates explicitly instead of relying on test-env defaults so the assertion keeps
    ;; passing even if the ambient defaults shift.
    (mt/with-premium-features #{}
      (mt/with-temp-vals-in-db :model/Metabot (internal-metabot-id)
                               {:use_verified_content false :collection_id nil}
        (with-redefs [data-complexity-score/record-score! (fn [& _] nil)]
          (let [resp (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)]
            ;; Full block equality, not just entity-count: both catalogs feed identical entity sets
            ;; (no hidden/routed/non-published tables exist on this fixture) into the same
            ;; deterministic scoring pipeline, and metabot's empty-scope `:collection-count` falls
            ;; back to the universe count, so every dimension and the total must match too.
            (is (= (:universe resp) (:metabot resp))))))))
  (testing ":metabot is scored separately when :content-verification + use_verified_content are both active"
    ;; Positive path: verified-only filtering restricts Cards to those with an active verified
    ;; moderation review. We inject a fresh unverified Card so the assertion doesn't depend on
    ;; ambient test-env content — the `:universe` count includes this Card, `:metabot` excludes it.
    (mt/with-premium-features #{:content-verification}
      (mt/with-temp [:model/Database {db-id :id} {}
                     :model/Card    _           {:database_id db-id
                                                 :type        :model
                                                 :name        "Unverified Only Card"
                                                 :archived    false}]
        (mt/with-temp-vals-in-db :model/Metabot (internal-metabot-id)
                                 {:use_verified_content true :collection_id nil}
          (with-redefs [data-complexity-score/record-score! (fn [& _] nil)]
            (let [resp (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)]
              (is (< (entity-count resp :metabot)
                     (entity-count resp :universe))
                  ":metabot entity-count must be strictly < :universe when verified-only filters out the injected Card"))))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-metabot-collection-scope-test
  (testing ":metabot is scoped to the internal Metabot's collection_id subtree (root + descendants)"
    ;; Fixture shape — exercises both halves of `metabot-collection-scope-ids`:
    ;;   parent     ← Metabot's collection_id; holds a Card directly (catches root-omitted regressions)
    ;;     └ child  → holds a nested Card (catches descent-dropped regressions)
    ;;   sibling    → holds the out-of-subtree Card
    ;;   empty      → no Cards; baseline scope so we can pin *exact* card-count deltas
    ;;
    ;; Tables pass through :metabot unfiltered, so ambient table counts cancel when we take
    ;; differentials against `empty`. That leaves us a clean count of Cards visible under each
    ;; scope, which lets us assert exact expected counts rather than relative inequalities.
    ;; Pin premium features off explicitly so `:verified-only?` can't drift in and confound.
    (mt/with-premium-features #{}
      (mt/with-temp [:model/Collection {parent-id :id}  {:name "Metabot Scope Parent"
                                                         :location "/"}
                     :model/Collection {child-id :id}   {:name     "Metabot Scope Child"
                                                         :location (format "/%d/" parent-id)}
                     :model/Collection {sibling-id :id} {:name "Metabot Scope Sibling"
                                                         :location "/"}
                     :model/Collection {empty-id :id}   {:name "Metabot Scope Empty"
                                                         :location "/"}
                     :model/Database {db-id :id}        {}
                     :model/Card _                      {:database_id   db-id
                                                         :type          :model
                                                         :name          "Metabot Root Card"
                                                         :archived      false
                                                         :collection_id parent-id}
                     :model/Card _                      {:database_id   db-id
                                                         :type          :model
                                                         :name          "Metabot In-subtree Nested Card"
                                                         :archived      false
                                                         :collection_id child-id}
                     :model/Card _                      {:database_id   db-id
                                                         :type          :metric
                                                         :name          "Metabot Out-of-subtree Card"
                                                         :archived      false
                                                         :collection_id sibling-id}]
        (let [counts-with-scope (fn [cid]
                                  (mt/with-temp-vals-in-db :model/Metabot (internal-metabot-id)
                                                           {:use_verified_content false
                                                            :collection_id cid}
                                    (with-redefs [data-complexity-score/record-score! (fn [& _] nil)]
                                      (let [resp (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)]
                                        {:metabot  (entity-count resp :metabot)
                                         :universe (entity-count resp :universe)}))))
              empty-counts   (counts-with-scope empty-id)
              parent-counts  (counts-with-scope parent-id)
              sibling-counts (counts-with-scope sibling-id)
              empty-count    (:metabot empty-counts)
              parent-count   (:metabot parent-counts)
              sibling-count  (:metabot sibling-counts)]
          (testing "scope=parent counts both the root Card and the nested descendant Card"
            ;; If the root collection id were dropped from `metabot-collection-scope-ids`, the
            ;; root Card would vanish and `parent-count` would land at `empty-count + 1`. If
            ;; descent regressed, the nested Card would vanish and `parent-count` would again
            ;; be `empty-count + 1`. Either regression fails this assertion.
            (is (= (+ empty-count 2) parent-count)
                "scope=parent :metabot must include BOTH parent-card (root) AND child-card (descendant)"))
          (testing "scope=sibling counts only the in-scope Card (out-of-subtree Card is excluded)"
            ;; If the collection-id filter were dropped entirely, `sibling-count` would jump to
            ;; `empty-count + 3` (all three fixture Cards visible), failing this assertion.
            (is (= (inc empty-count) sibling-count)
                "scope=sibling :metabot must include only sibling-card — collection filter must apply"))
          (testing ":universe entity-count is unaffected by Metabot collection scope"
            ;; Guards against a regression where the subtree filter leaks into `:universe`
            ;; scoring. If it did, `:universe` counts would move in lockstep with `:metabot`
            ;; across the three scopes and this assertion would fail.
            (is (= (:universe empty-counts)
                   (:universe parent-counts)
                   (:universe sibling-counts))
                ":universe must be unscoped regardless of Metabot.collection_id")))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-allows-active-scheduled-claim-test
  (testing "manual API recalculation does not share the cron/boot scoring claim"
    (let [active-claim (pr-str {:fingerprint "older-fingerprint"
                                :claimed-at  (System/currentTimeMillis)
                                :owner       "scheduled-owner"})
          scoring-ran? (atom false)]
      (mt/with-temporary-setting-values [data-complexity-scoring-claim active-claim]
        (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                      task.complexity-score/current-fingerprint (constantly "api-test-fp")
                      data-complexity-score/record-score!       (fn [& _] nil)
                      complexity/complexity-scores
                      (fn [& _]
                        (reset! scoring-ran? true)
                        stub-scores)]
          (is (= (m.util/deep-snake-keys stub-scores)
                 (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)))
          (is (true? @scoring-ran?)
              "force recalculation should compute independently of scheduled claims")
          (is (= active-claim (data-complexity-score.settings/data-complexity-scoring-claim))))))))

(deftest ^:sequential complexity-endpoint-force-recalculation-rejects-concurrent-requests-test
  (testing "a second concurrent request fast-fails with 409 instead of running a duplicate scoring pass"
    ;; Block the stubbed scoring call on a latch so the second request is guaranteed to land
    ;; while the guard is held. Plain `with-redefs` (not `with-dynamic-fn-redefs`) because
    ;; the dynamic variant binds thread-locally and the futures we spawn here wouldn't see it.
    (let [release-scoring (CountDownLatch. 1)
          scoring-started (CountDownLatch. 1)
          call-count      (atom 0)]
      (with-redefs [metabot-scope/internal-metabot-scope      (constantly {})
                    task.complexity-score/current-fingerprint (constantly "api-test-fp")
                    data-complexity-score/record-score!       (fn [& _] nil)
                    complexity/complexity-scores
                    (fn [& _]
                      (swap! call-count inc)
                      (.countDown scoring-started)
                      (.await release-scoring 10 TimeUnit/SECONDS)
                      stub-scores)]
        (let [first-request (future (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true))]
          (try
            (is (.await scoring-started 10 TimeUnit/SECONDS)
                "first request must reach the guarded section before we fire the second")
            (testing "concurrent superuser request is rejected with 409"
              (is (= "Data Complexity Score calculation already in progress"
                     (mt/user-http-request :crowberto :get 409 endpoint :force-recalculation true))))
            (finally
              (.countDown release-scoring)
              ;; Drain the in-flight request so the guard is released before the next test
              ;; (failed assertions above shouldn't leak a stuck scoring call into other tests).
              (deref first-request 10000 ::timeout))))
        (testing "only the first request actually ran scoring; the second short-circuited"
          (is (= 1 @call-count)))
        (testing "guard is released after the in-flight request finishes — a follow-up request succeeds"
          (mt/user-http-request :crowberto :get 200 endpoint :force-recalculation true)
          (is (= 2 @call-count)))))))

(deftest internal-metabot-scope-test
  (testing ":verified-only? is true only when the premium feature + use_verified_content both apply"
    (doseq [{:keys [features use-verified? expected-verified?]}
            [{:features #{}                        :use-verified? false :expected-verified? false}
             {:features #{}                        :use-verified? true  :expected-verified? false}
             {:features #{:content-verification}   :use-verified? false :expected-verified? false}
             {:features #{:content-verification}   :use-verified? true  :expected-verified? true}]]
      (testing (format "features=%s use_verified_content=%s" (pr-str features) use-verified?)
        (mt/with-premium-features features
          (mt/with-temp-vals-in-db :model/Metabot (internal-metabot-id)
                                   {:use_verified_content use-verified? :collection_id nil}
            (is (= {:verified-only? expected-verified? :collection-id nil}
                   (metabot-scope/internal-metabot-scope))))))))
  (testing ":collection-id is read straight from the internal Metabot row regardless of premium features"
    (mt/with-temp [:model/Collection {coll-id :id} {:name "metabot scope test coll"}]
      (mt/with-premium-features #{}
        (mt/with-temp-vals-in-db :model/Metabot (internal-metabot-id)
                                 {:use_verified_content false :collection_id coll-id}
          (is (= {:verified-only? false :collection-id coll-id}
                 (metabot-scope/internal-metabot-scope))))))))
