import type { ColumnTypes, CreateCustomVisualization } from "custom-viz";

import {
  measureText,
  measureTextHeight,
  measureTextWidth,
} from "metabase/utils/measure-text";
import { customVizColumnTypes } from "metabase-lib/v1/types/utils/custom-viz-column-types";

import { formatValue } from "./custom-viz-utils";

declare global {
  interface Window {
    __METABASE_VIZ_API__?: {
      columnTypes: ColumnTypes;
      formatValue: typeof formatValue;
      measureText: typeof measureText;
      measureTextWidth: typeof measureTextWidth;
      measureTextHeight: typeof measureTextHeight;
    };
    __customVizPlugin__?: CreateCustomVisualization<Record<string, unknown>>;
  }
}

export function ensureVizApi() {
  window.__METABASE_VIZ_API__ = {
    ...window.__METABASE_VIZ_API__,
    columnTypes: customVizColumnTypes,
    formatValue,
    measureText,
    measureTextWidth,
    measureTextHeight,
  };
}

export {};
