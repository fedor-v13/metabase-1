import {
  ABSOLUTE_MAX_ROW_LIMIT,
  DEFAULT_AGGREGATED_ROW_LIMIT,
  HARD_ROW_LIMIT,
} from "metabase-lib/v1/queries/utils";

import { useSetting } from "./use-setting";

/**
 * Max rows the backend returns for a raw-rows question. Configurable per
 * instance via MB_UNAGGREGATED_QUERY_ROW_LIMIT.
 */
export const useHardRowLimit = () =>
  useSetting("unaggregated-query-row-limit") ?? HARD_ROW_LIMIT;

/**
 * Max rows the backend returns for an aggregated question. Configurable per
 * instance via MB_AGGREGATED_QUERY_ROW_LIMIT. This also caps the unaggregated
 * limit, so raising only that one has no effect beyond this value.
 */
export const useAggregatedRowLimit = () =>
  useSetting("aggregated-query-row-limit") ?? DEFAULT_AGGREGATED_ROW_LIMIT;

/**
 * Max rows in a file export. Configurable per instance via
 * MB_DOWNLOAD_ROW_LIMIT, which can only raise the limit above
 * ABSOLUTE_MAX_ROW_LIMIT, never lower it.
 *
 * xlsx is excluded because Excel's file format caps a sheet at
 * ABSOLUTE_MAX_ROW_LIMIT rows regardless of the setting.
 */
export const useDownloadRowLimit = (format?: string) => {
  const limit = useSetting("download-row-limit") ?? ABSOLUTE_MAX_ROW_LIMIT;
  return format === "xlsx" ? ABSOLUTE_MAX_ROW_LIMIT : limit;
};
