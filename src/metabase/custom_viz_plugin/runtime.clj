(ns metabase.custom-viz-plugin.runtime
  "Shaping of custom visualization plugin records into the safe *runtime* response — the shape a
   viewer needs to fetch and register a plugin, with no bundle bytes and nothing about who uploaded
   it.

   Shared by the authenticated `/api/ee/custom-viz-plugin/list` endpoint and by the entity-scoped
   embed endpoints, so the two can't drift on which plugins are considered loadable."
  (:require
   [metabase.custom-viz-plugin.manifest :as manifest]
   [metabase.custom-viz-plugin.models.custom-viz-plugin :as custom-viz-plugin]
   [metabase.custom-viz-plugin.settings :as custom-viz.settings]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

(def RuntimeResponse
  "Response schema for a plugin a viewer is allowed to load."
  [:map
   [:id              ms/PositiveInt]
   [:identifier      ms/NonBlankString]
   [:display_name    ms/NonBlankString]
   [:icon            {:optional true} [:maybe :string]]
   [:bundle_url      ms/NonBlankString]
   [:bundle_hash     {:optional true} [:maybe :string]]
   [:dev_bundle_url  {:optional true} [:maybe :string]]
   [:manifest        {:optional true} [:maybe :any]]])

(defn dev-only-plugin?
  "Returns true if the plugin has no uploaded bundle and is served from a dev URL."
  [plugin]
  (nil? (:bundle_hash plugin)))

(defn plugin->runtime-response
  "Convert a plugin record to the safe runtime response shape.

   `base-path` is the route the bundle is served from (e.g. `/api/ee/custom-viz-plugin`), so embed
   callers can hand back their own entity-scoped path instead. `bundle_url` is suffixed with
   `?v=<bundle_hash>` so that a re-uploaded bundle is fetched instead of served from the browser's
   `immutable` cache."
  [{:keys [id identifier display_name icon bundle_hash manifest dev_bundle_url]} base-path]
  (cond-> {:id           id
           :identifier   identifier
           :display_name display_name
           :icon         icon
           :bundle_url   (cond-> (format "%s/%d/bundle" base-path id)
                           bundle_hash (str "?v=" bundle_hash))
           :bundle_hash  bundle_hash
           :manifest     manifest}
    dev_bundle_url (assoc :dev_bundle_url dev_bundle_url)))

(defn loadable-plugins
  "Active, enabled plugins whose manifest is compatible with this Metabase version, ordered by display
   name. Dev-only plugins are excluded when dev mode is disabled.

   Does no permission checking — callers decide who is allowed to see the result."
  []
  (let [dev-mode? (custom-viz.settings/custom-viz-plugin-dev-mode-enabled)]
    (->> (custom-viz-plugin/select-non-blob :status :active
                                            :enabled true
                                            {:order-by [[:display_name :asc]]})
         (filter manifest/compatible?)
         (remove #(and (not dev-mode?) (dev-only-plugin? %))))))
