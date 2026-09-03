// Defaults for the backend's row limits, used as fallbacks when the
// corresponding setting is unset. The live values are configurable per instance
// (MB_UNAGGREGATED_QUERY_ROW_LIMIT / MB_AGGREGATED_QUERY_ROW_LIMIT /
// MB_DOWNLOAD_ROW_LIMIT), so read them via `metabase/common/hooks/use-row-limit`
// rather than using these constants directly.

// Raw-rows questions. Mirrors `default-unaggregated-query-row-limit`.
export const HARD_ROW_LIMIT = 2000;

// Aggregated questions. Mirrors `default-aggregated-query-row-limit`.
export const DEFAULT_AGGREGATED_ROW_LIMIT = 10000;

// The ceiling the query processor never exceeds, and the default export limit.
// One less than Excel's max rows because of the header row, which is also why
// xlsx exports can never go above it. Mirrors `absolute-max-results`.
export const ABSOLUTE_MAX_ROW_LIMIT = 1048575;
