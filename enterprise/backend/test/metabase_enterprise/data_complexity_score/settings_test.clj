(ns metabase-enterprise.data-complexity-score.settings-test
  (:require
   [clojure.test :refer :all]
   [metabase-enterprise.data-complexity-score.settings :as settings]
   [metabase.test :as mt]))

(deftest ^:sequential semantic-complexity-level-defaults-to-2-test
  (testing "the setting defaults to 2 (the level this build actually implements in full)"
    (mt/discard-setting-changes [semantic-complexity-level]
      (settings/semantic-complexity-level! nil)
      (is (= 2 (settings/semantic-complexity-level))))))

(deftest ^:sequential effective-level-clamps-out-of-range-values-test
  (testing "effective-level clamps to [0, max-level] so out-of-range setting values don't crash
            the scorer or silently disable scoring"
    (mt/discard-setting-changes [semantic-complexity-level]
      (doseq [[raw expected] [[-1 0]
                              [0 0]
                              [1 1]
                              [2 2]
                              [(inc settings/max-level) settings/max-level]
                              [9999 settings/max-level]]]
        (settings/semantic-complexity-level! raw)
        (is (= expected (settings/effective-level))
            (format "raw setting %d should clamp to %d" raw expected))))))

(deftest ^:sequential effective-level-falls-back-to-default-after-nil-set-test
  (testing "after (setter! nil) clears the override, the defsetting default (2) wins —
            not 0. The setter treats nil as 'unset', so the next read goes through the default,
            not through `clamp-level`'s nil → 0 fallback (that path only fires for an explicit
            caller-supplied nil at a level-consuming site)."
    (mt/discard-setting-changes [semantic-complexity-level]
      (settings/semantic-complexity-level! nil)
      (is (= 2 (settings/effective-level))
          "after (setter! nil), defsetting default wins"))))

(deftest ^:parallel clamp-level-handles-explicit-overrides-test
  (testing "clamp-level clamps caller-supplied overrides to [0, max-level] so an explicit :level
            override can't bypass the guard that effective-level applies to the setting read"
    (doseq [[raw expected] [[nil 0]
                            [-1 0]
                            [0 0]
                            [1 1]
                            [settings/max-level settings/max-level]
                            [(inc settings/max-level) settings/max-level]
                            [9999 settings/max-level]]]
      (is (= expected (settings/clamp-level raw))
          (format "raw %s should clamp to %d" (pr-str raw) expected)))))
