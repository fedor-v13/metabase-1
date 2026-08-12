(ns metabase.custom-viz-plugin.embed-api
  "Entity-scoped custom visualization lookups for embed viewers — public links, signed static embeds,
   and guest embeds.

   Nothing here does a `read-check`: an embed viewer is anonymous, so there is no user to check. What
   bounds these helpers instead is the *entity*. The caller resolves the shared card or dashboard
   first, applying whatever guard its own namespace already applies (public sharing enabled, a valid
   signed token, `enable_embedding`), then hands us the `custom:*` displays that entity actually
   renders. Only the plugins backing those displays are listed or served — every other installed
   plugin stays invisible and its id is not enumerable from an embed."
  (:require
   [clojure.string :as str]
   [metabase.custom-viz-plugin.cache :as cache]
   [metabase.custom-viz-plugin.runtime :as custom-viz.runtime]
   [metabase.custom-viz-plugin.settings :as custom-viz.settings]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def RuntimeResponse
  "Response schema for a plugin an embed viewer is allowed to load. Re-exported so embed namespaces
   only have to reach for this one namespace."
  custom-viz.runtime/RuntimeResponse)

(def ^:private display-prefix "custom:")

(defn- custom-display
  "Normalize a display value (a keyword on `Card`, a string in dashcard viz settings) to a
   `custom:*` display string, or nil when it isn't a custom visualization."
  [display]
  (let [s (cond
            (keyword? display) (name display)
            (string? display)  display)]
    (when (and s (str/starts-with? s display-prefix))
      s)))

(defn- identifier->display [identifier]
  (str display-prefix identifier))

;;; ------------------------------------------- Display collection -------------------------------------------

(defn card-displays
  "The set of `custom:*` displays used by the Cards with `card-ids`."
  [card-ids]
  (let [card-ids (into #{} (remove nil?) card-ids)]
    (if (empty? card-ids)
      #{}
      (into #{}
            (keep (comp custom-display :display))
            (t2/select [:model/Card :display] :id [:in card-ids])))))

(defn dashboard-displays
  "The set of `custom:*` displays rendered by the Dashboard with `dashboard-id`.

   Covers more than the dashcards' own cards: added `series` cards each render with their own
   display, and a visualizer dashcard overrides the display of its card from the dashcard's
   `visualization_settings`."
  [dashboard-id]
  (let [dashcards       (t2/select [:model/DashboardCard :id :card_id :visualization_settings]
                                   :dashboard_id dashboard-id)
        series-card-ids (when (seq dashcards)
                          (t2/select-fn-set :card_id :model/DashboardCardSeries
                                            :dashboardcard_id [:in (map :id dashcards)]))
        visualizer      (into #{}
                              (keep #(custom-display (get-in % [:visualization_settings :visualization :display])))
                              dashcards)]
    (into visualizer
          (card-displays (into (set series-card-ids) (map :card_id) dashcards)))))

;;; ------------------------------------------- Scoped plugin access -------------------------------------------

(defn- scoped-plugins
  "Loadable plugins whose display is in `displays`. Empty when custom visualizations are turned off
   for this instance."
  [displays]
  (let [displays (set displays)]
    (if (or (empty? displays)
            (not (custom-viz.settings/custom-viz-enabled)))
      []
      (filter #(contains? displays (identifier->display (:identifier %)))
              (custom-viz.runtime/loadable-plugins)))))

(defn plugins-for-displays
  "Runtime responses for the plugins backing `displays`, with each `bundle_url` rooted at `base-path`
   (e.g. `/api/public/card/<uuid>/custom-viz-plugin`)."
  [displays base-path]
  (mapv #(custom-viz.runtime/plugin->runtime-response % base-path)
        (scoped-plugins displays)))

(defn bundle-response
  "Ring response serving the JS bundle for `plugin-id`, but only when that plugin backs one of
   `displays`. Anything else — a plugin the embedded entity doesn't use, a disabled or incompatible
   one, or an instance with custom visualizations turned off — is a 404."
  [plugin-id displays]
  (if-let [plugin (first (filter #(= plugin-id (:id %)) (scoped-plugins displays)))]
    (let [dev-url (cache/resolve-dev-bundle plugin-id)
          entry   (cache/resolve-bundle plugin)]
      (if entry
        {:status  200
         :headers (cond-> {"Content-Type"                 "application/javascript"
                           "X-Content-Type-Options"       "nosniff"
                           "Cross-Origin-Resource-Policy" "same-origin"
                           "Referrer-Policy"              "no-referrer"
                           "ETag"                         (:hash entry)}
                    dev-url       (assoc "Cache-Control" "no-store")
                    (not dev-url) (assoc "Cache-Control" "public, max-age=31536000, immutable"))
         :body    (:content entry)}
        {:status  503
         :headers {"Content-Type" "application/json"}
         :body    "{\"error\": \"Bundle not available\"}"}))
    {:status  404
     :headers {"Content-Type" "application/json"}
     :body    "{\"error\": \"Not found\"}"}))
