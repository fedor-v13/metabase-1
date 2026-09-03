import { msgid, ngettext, t } from "ttag";

import { formatNumber } from "metabase/utils/formatting/numbers";
import type { Dataset } from "metabase-types/api";

export const formatRowCount = (count: number) => {
  const countString = formatNumber(count);
  return ngettext(msgid`${countString} row`, `${countString} rows`, count);
};

export function getRowCountMessage(
  result: Dataset,
  hardRowLimit: number,
): string {
  if (result.data.rows_truncated > 0) {
    return t`Showing first ${formatRowCount(result.row_count)}`;
  }
  if (result.row_count === hardRowLimit) {
    return t`Showing first ${formatRowCount(hardRowLimit)}`;
  }
  return t`Showing ${formatRowCount(result.row_count)}`;
}
