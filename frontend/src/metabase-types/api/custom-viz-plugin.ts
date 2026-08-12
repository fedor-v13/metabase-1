export interface CustomVizPluginManifest {
  name?: string;
  icon?: string;
  metabase?: {
    version?: string;
  };
}

export type CustomVizPluginId = number;

export interface CustomVizPlugin {
  id: CustomVizPluginId;
  display_name: string;
  identifier: string;
  status: "pending" | "active" | "error";
  enabled: boolean;
  icon: string | null;
  error_message: string | null;
  bundle_hash?: string | null;
  dev_bundle_url?: string | null;
  dev_only: boolean;
  manifest?: CustomVizPluginManifest | null;
  metabase_version?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomVizPluginRuntime {
  id: CustomVizPluginId;
  identifier: string;
  display_name: string;
  icon: string | null;
  bundle_url: string;
  bundle_hash?: string | null;
  dev_bundle_url?: string | null;
  manifest?: CustomVizPluginManifest | null;
}

/**
 * Addresses the entity-scoped plugin routes an embed viewer uses: the shared
 * card/dashboard is identified by its public `uuid` or its signed `token`, and
 * only the plugins that entity renders are listed.
 */
export interface ListEmbeddedCustomVizPluginsRequest {
  entityType: "card" | "dashboard";
  uuid: string | null;
  token: string | null;
}

export interface CreateCustomVizPluginRequest {
  file: File;
}

export interface CreateDevCustomVizPluginRequest {
  dev_bundle_url: string;
}

export interface UpdateCustomVizPluginRequest {
  id: CustomVizPluginId;
  enabled?: boolean;
}

export interface ReplaceCustomVizPluginBundleRequest {
  id: CustomVizPluginId;
  file: File;
}
