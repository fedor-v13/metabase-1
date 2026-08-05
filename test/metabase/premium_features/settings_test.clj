(ns metabase.premium-features.settings-test
  (:require
   [clojure.test :refer :all]
   [metabase.custom-viz-plugin.settings :as custom-viz.settings]
   [metabase.premium-features.core :as premium-features]
   [metabase.premium-features.test-util :as tu]
   [metabase.test :as mt]))

(deftest enable-custom-viz-test
  (testing "enable-custom-viz? is false by default (setting defaults to false)"
    (is (false? (premium-features/enable-custom-viz?))))
  (testing "enable-custom-viz? is true when admin opts in via the setting"
    (mt/with-temporary-setting-values [csp-img-enabled true
                                       custom-viz-enabled true]
      (is (true? (premium-features/enable-custom-viz?)))))
  (testing "enable-custom-viz? does not depend on the token — custom viz ships in every edition"
    (tu/with-premium-features #{}
      (mt/with-temporary-setting-values [csp-img-enabled true
                                         custom-viz-enabled true]
        (is (true? (premium-features/enable-custom-viz?))))))
  (testing "MB_CUSTOM_VIZ_ENABLED env var can toggle the setting"
    (mt/with-temp-env-var-value! ["MB_CUSTOM_VIZ_ENABLED" "true"]
      (is (true? (custom-viz.settings/custom-viz-enabled)))
      (is (true? (premium-features/enable-custom-viz?))))))

(deftest custom-viz-available-token-feature-test
  (testing "custom-viz-available is always true — the feature ships in every edition"
    (tu/with-premium-features #{}
      (is (true? (:custom-viz-available (premium-features/token-features)))))))
