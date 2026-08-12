import { useCallback, useEffect, useMemo, useState } from "react";

import { useSdkSelector } from "embedding-sdk-bundle/store";
import { getIsGuestEmbed } from "embedding-sdk-bundle/store/selectors";
import { useMetabaseProviderPropsStore } from "embedding-sdk-shared/hooks/use-metabase-provider-props-store";
import { ensureMetabaseProviderPropsStore } from "embedding-sdk-shared/lib/ensure-metabase-provider-props-store";
import { customVizPluginApi } from "metabase/api/custom-viz-plugin";
import { api } from "metabase/api/client";
import type { IconData } from "metabase/common/utils/icon";
import { PLUGIN_CUSTOM_VIZ } from "metabase/plugins";
import type { DispatchFn } from "metabase/redux/hooks";
import MetabaseSettings from "metabase/utils/settings";
import { CustomVizSettingWidget } from "metabase/visualizations/custom-visualizations/components/CustomVizSettingWidget";
import type { LoadCustomVizPluginOptions } from "metabase/visualizations/custom-visualizations/custom-viz-plugins";
import {
  loadCustomVizPlugin as baseLoadCustomVizPlugin,
  useAutoLoadCustomVizPlugin as baseUseAutoLoadCustomVizPlugin,
  useCustomVizPlugins as baseUseCustomVizPlugins,
  unregisterCustomVizDisplay,
  useCustomVizPlugins,
} from "metabase/visualizations/custom-visualizations/custom-viz-plugins";
import {
  getCustomPluginIdentifier,
  getPluginAssetUrl,
} from "metabase/visualizations/custom-visualizations/custom-viz-utils";
import type { SandboxMode } from "metabase/visualizations/custom-visualizations/sandbox";
import { isWidgetMount } from "metabase/visualizations/custom-visualizations/widget-mount";
import type {
  CustomVizPluginId,
  CustomVizPluginRuntime,
  ListEmbeddedCustomVizPluginsRequest,
  VisualizationDisplay,
} from "metabase-types/api";
import { isCustomVizDisplay } from "metabase-types/guards/visualization";

/**
 * Allowlist of plugin identifiers from the `allowedCustomVisualizations`
 * MetabaseProvider prop. Empty / undefined = no custom viz allowed.
 */
function useAllowlist(): string[] {
  const { state } = useMetabaseProviderPropsStore();
  return state?.props?.allowedCustomVisualizations ?? [];
}

function getAllowlist(): string[] {
  return (
    ensureMetabaseProviderPropsStore().getState().props
      ?.allowedCustomVisualizations ?? []
  );
}

/**
 * Mirror of the last `sdk.isGuestEmbed` any of the hook overrides below saw.
 *
 * `loadCustomVizPlugin` is called from effects, with no React context to read
 * the SDK store from, and the props store isn't populated on the web-component
 * path (guest embeds render through `ComponentProvider`, which never calls
 * `setProps`). Every path that can reach it has already rendered a component
 * that read `useIsGuestEmbed`, so this is in sync by the time it's used.
 */
let lastSeenGuestEmbed = false;

/**
 * In the npm SDK, `allowedCustomVisualizations` is the host developer's opt-in
 * to running third-party JS inside their own page, so defaulting to "none" is
 * right. A guest embed is different: it renders in a Metabase-origin iframe with
 * a signed JWT already scoping what the viewer may see, and the web-component
 * host never gets a chance to pass the prop — defaulting to "none" there would
 * mean custom visualizations could never render. So in guest-embed mode the
 * JWT's entity scope is the authorization, and an allowlist, when the host does
 * supply one, only narrows things further.
 */
function useIsGuestEmbed(): boolean {
  const guestEmbed = useSdkSelector(getIsGuestEmbed);
  lastSeenGuestEmbed = guestEmbed;
  return guestEmbed;
}

/**
 * A guest embed is served from a Metabase-origin page under Metabase's strict
 * no-`unsafe-eval` CSP, which is exactly what the hosted sandbox document exists
 * for. The npm SDK renders in the host's own page, where `about:blank` works.
 */
function sandboxModeFor(guestEmbed: boolean): SandboxMode {
  return guestEmbed ? "hosted" : "blank";
}

/**
 * Whether a `custom:*` plugin identifier passes the allowlist. Non-custom
 * displays are never "allowed" in this sense — callers handle them separately.
 */
function isAllowedByAllowlist(
  display: string | undefined,
  allowlist: string[],
  guestEmbed: boolean,
): boolean {
  if (!isCustomVizDisplay(display)) {
    return false;
  }
  return guestEmbed && allowlist.length === 0
    ? true
    : allowlist.includes(display);
}

const warnedUnknownCustomViz = new Set<string>();
function warnUnknownCustomViz(display: string) {
  if (!warnedUnknownCustomViz.has(display)) {
    warnedUnknownCustomViz.add(display);
    console.warn(
      `Custom visualization "${display}" was requested but no matching ` +
        `installed plugin was found. Check the name and that the plugin is uploaded.`,
    );
  }
}

const pluginToIconBlob = new Map<CustomVizPluginId, string>();
const pluginToIconBlobPromise = new Map<
  CustomVizPluginId,
  Promise<string | undefined>
>();

// A cross-origin `<img>` can't carry the session header, so we fetch the icon
// with the auth in the headers and hand back a same-origin `blob:` url.
export const sdkCustomVizAssetManager = {
  resolveCustomVizAssetUrl: async (
    pluginId: CustomVizPluginId,
    assetPath: string | null | undefined,
  ): Promise<string | undefined> => {
    if (!assetPath) {
      return undefined;
    }
    let promise = pluginToIconBlobPromise.get(pluginId);
    if (!promise) {
      promise = (async () => {
        try {
          const res = await api.fetch({
            method: "GET",
            url: `/api/ee/custom-viz-plugin/${pluginId}/asset`,
            params: { path: assetPath },
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const objectUrl = URL.createObjectURL(await res.blob());
          pluginToIconBlob.set(pluginId, objectUrl);
          return objectUrl;
        } catch {
          // Drop the failed promise so a later call can retry
          pluginToIconBlobPromise.delete(pluginId);
          return getPluginAssetUrl(pluginId, assetPath);
        }
      })();
      pluginToIconBlobPromise.set(pluginId, promise);
    }
    return promise;
  },
  releaseCustomVizAsset: (pluginId: CustomVizPluginId) => {
    const objectUrl = pluginToIconBlob.get(pluginId);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    pluginToIconBlob.delete(pluginId);
    pluginToIconBlobPromise.delete(pluginId);
  },
};

export function initializeSdkCustomVizPlugin() {
  if (!MetabaseSettings.get("token-features")?.["custom-viz"]) {
    return;
  }

  Object.assign(PLUGIN_CUSTOM_VIZ, {
    ...sdkCustomVizAssetManager,

    loadCustomVizPlugin: (
      plugin: CustomVizPluginRuntime,
      options: LoadCustomVizPluginOptions = {},
    ) => {
      // We should only be calling this for allowed plugins, but this checks again to be safer
      const guestEmbed = lastSeenGuestEmbed;
      if (
        !isAllowedByAllowlist(
          getCustomPluginIdentifier(plugin),
          getAllowlist(),
          guestEmbed,
        )
      ) {
        return Promise.resolve(null);
      }
      return baseLoadCustomVizPlugin(plugin, {
        ...options,
        // Note: in the future we might want to check the domain to check if we need "blank" or "sandbox" mode, to support data apps
        sandboxMode: sandboxModeFor(guestEmbed),
      });
    },

    loadCustomVizPluginForDisplay: async (
      dispatch: DispatchFn,
      display: string,
      embedRequest?: ListEmbeddedCustomVizPluginsRequest,
    ): Promise<string | null> => {
      // An `embedRequest` only exists in guest-embed mode, so it is the
      // authoritative signal here — no need for the mirrored flag.
      const guestEmbed = Boolean(embedRequest) || lastSeenGuestEmbed;
      if (!isAllowedByAllowlist(display, getAllowlist(), guestEmbed)) {
        return null;
      }
      const identifier = display.slice("custom:".length);
      const action = dispatch(
        embedRequest
          ? customVizPluginApi.endpoints.listEmbeddedCustomVizPlugins.initiate(
              embedRequest,
            )
          : customVizPluginApi.endpoints.listCustomVizPlugins.initiate(
              undefined,
            ),
      );
      try {
        const plugins = await action.unwrap();
        const plugin = plugins.find((p) => p.identifier === identifier);
        if (!plugin) {
          warnUnknownCustomViz(display);
          return null;
        }
        return await baseLoadCustomVizPlugin(plugin, {
          sandboxMode: sandboxModeFor(guestEmbed),
        });
      } catch {
        return null;
      } finally {
        action.unsubscribe();
      }
    },

    useAutoLoadCustomVizPlugin: (display: string | undefined) => {
      const allowlist = useAllowlist();
      const guestEmbed = useIsGuestEmbed();
      const allowed =
        // Regular (non-custom) displays are always allowed.
        !isCustomVizDisplay(display) ||
        isAllowedByAllowlist(display, allowlist, guestEmbed);

      useEffect(() => {
        if (isCustomVizDisplay(display) && !allowed) {
          unregisterCustomVizDisplay(display);
        }
      }, [display, allowed]);

      return baseUseAutoLoadCustomVizPlugin(allowed ? display : undefined, {
        sandboxMode: sandboxModeFor(guestEmbed),
      });
    },

    useCustomVizPlugins: (opts?: { enabled?: boolean }) => {
      const allowlist = useAllowlist();
      const guestEmbed = useIsGuestEmbed();
      const result = baseUseCustomVizPlugins(opts);
      // Key on the allowlist contents, not the array identity: the host may
      // pass a new (inline) array on every render.
      const allowlistKey = JSON.stringify(allowlist);
      // Memoized so consumers can use `plugins` as an effect dependency:
      // returning a fresh `.filter()` array on every render would re-trigger
      // those effects in a render loop.
      const plugins = useMemo(
        () =>
          result.plugins?.filter((p) =>
            isAllowedByAllowlist(
              getCustomPluginIdentifier(p),
              allowlist,
              guestEmbed,
            ),
          ) ?? [],
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allowlistKey stands in for `allowlist`
        [result.plugins, allowlistKey, guestEmbed],
      );

      // Warn the developers of the host app if they're passing a custom viz that we haven't found in the instance
      useEffect(() => {
        if (result.isLoading || !result.plugins) {
          return;
        }
        const installed: string[] = result.plugins.map((p) =>
          getCustomPluginIdentifier(p),
        );
        allowlist
          .filter((name) => !installed.includes(name))
          .forEach(warnUnknownCustomViz);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allowlistKey stands in for `allowlist`
      }, [result.plugins, result.isLoading, allowlistKey]);

      return { ...result, plugins };
    },

    useCustomVizPluginsIcon: () => {
      const [blobs, setBlobs] = useState(new Map<CustomVizPluginId, string>());
      const allowlist = useAllowlist();
      const guestEmbed = useIsGuestEmbed();

      const { plugins, isLoading } = useCustomVizPlugins();

      const allowlistKey = JSON.stringify(allowlist); // stable reference as the array can be a new one on every render

      useEffect(() => {
        let cancelled = false;
        const toResolve = (plugins ?? []).filter(
          (plugin) =>
            isAllowedByAllowlist(
              getCustomPluginIdentifier(plugin),
              allowlist,
              guestEmbed,
            ) && plugin.icon,
        );
        Promise.all(
          toResolve.map(
            async (plugin) =>
              [
                plugin.id,
                await sdkCustomVizAssetManager.resolveCustomVizAssetUrl(
                  plugin.id,
                  plugin.icon,
                ),
              ] as const,
          ),
        ).then((entries) => {
          if (!cancelled) {
            setBlobs(
              new Map(
                entries.filter(
                  (entry): entry is [CustomVizPluginId, string] =>
                    entry[1] != null,
                ),
              ),
            );
          }
        });
        return () => {
          cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allowlistKey stands in for `allowlist`
      }, [plugins, allowlistKey]);

      return useCallback(
        (
          display: VisualizationDisplay,
        ): { icon: IconData | undefined; isLoading: boolean } => {
          if (isLoading) {
            return { icon: undefined, isLoading: true };
          }
          const currentPlugin = plugins?.find(
            (plugin) => getCustomPluginIdentifier(plugin) === display,
          );

          // not an allowed custom-viz plugin: no icon
          if (
            !currentPlugin ||
            !isAllowedByAllowlist(display, allowlist, guestEmbed)
          ) {
            return { icon: undefined, isLoading: false };
          }

          // resolved blob is ready: use it
          const blobUrl = blobs.get(currentPlugin.id);
          if (blobUrl) {
            return {
              icon: { name: "unknown", iconUrl: blobUrl },
              isLoading: false,
            };
          }

          // otherwise still loading (the effect is resolving it), unless the
          // plugin has no icon to resolve at all
          return { icon: undefined, isLoading: Boolean(currentPlugin.icon) };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allowlistKey stands in for `allowlist`
        [plugins, isLoading, allowlistKey, blobs],
      );
    },
    getPluginAssetUrl,
    isCustomVizDisplay,
    isWidgetMount,
    CustomVizSettingWidget,
    // Admin pages (ManageCustomVizPage, CustomVizPage, CustomVizDevPage) are
    // intentionally omitted — the SDK never renders them.
  });
}
