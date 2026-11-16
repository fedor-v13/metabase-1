import { t } from "ttag";

import type { TimeOfDayTab } from "./types";

export const TABS: TimeOfDayTab[] = [
  {
    get label() {
      return t`Between`;
    },
    operator: "between",
  },
  {
    get label() {
      return t`Before`;
    },
    operator: "<",
  },
  {
    get label() {
      return t`After`;
    },
    operator: ">",
  },
];

export const DEFAULT_START_HOUR = 9;

export const DEFAULT_END_HOUR = 17;
