import { PLUGIN_CUSTOM_VIZ } from "metabase/plugins";
import MetabaseSettings from "metabase/utils/settings";
import { isCustomVizDisplay } from "metabase-types/guards/visualization";

import { CustomVizSettingWidget } from "./components/CustomVizSettingWidget";
import {
  loadCustomVizPlugin,
  useAutoLoadCustomVizPlugin,
  useCustomVizPlugins,
  useCustomVizPluginsIcon,
} from "./custom-viz-plugins";
import { getPluginAssetUrl, resolveCustomVizAssetUrl } from "./custom-viz-utils";
import { isWidgetMount } from "./widget-mount";

/**
 * Wire the custom visualization runtime into `PLUGIN_CUSTOM_VIZ` for the main app.
 *
 * Gated on the `custom-viz` token feature, which an admin turns on through the
 * `custom-viz-enabled` setting. `useCustomVizPlugins` fires
 * `GET /api/ee/custom-viz-plugin/list` wherever it is called — the chart type
 * sidebar and the icon hooks — so registering unconditionally would add that
 * request to every query builder load on instances that never enabled it.
 *
 * The synchronous settings read works at module load time because
 * `window.MetabaseBootstrap` is already populated, which is why this can run
 * before the first `refreshSiteSettings()`.
 */
export function initializeCustomViz() {
  if (!MetabaseSettings.get("token-features")?.["custom-viz"]) {
    return;
  }

  Object.assign(PLUGIN_CUSTOM_VIZ, {
    useAutoLoadCustomVizPlugin,
    useCustomVizPlugins,
    loadCustomVizPlugin,
    getPluginAssetUrl,
    resolveCustomVizAssetUrl,
    releaseCustomVizAsset: () => {},
    useCustomVizPluginsIcon,
    isCustomVizDisplay,
    isWidgetMount,
    CustomVizSettingWidget,
  });
}
