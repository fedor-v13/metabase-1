import dayjs from "dayjs";

import type {
  TimeOfDayPickerOperator,
  TimeOfDayPickerValue,
} from "metabase/querying/common/types";

import { DEFAULT_END_HOUR, DEFAULT_START_HOUR } from "./constants";

function timeOfDay(hour: number) {
  return dayjs().startOf("day").hour(hour).toDate();
}

function getValueCount(operator: TimeOfDayPickerOperator) {
  return operator === "between" ? 2 : 1;
}

export function getDefaultValue(): TimeOfDayPickerValue {
  return {
    type: "time-of-day",
    operator: "between",
    values: [timeOfDay(DEFAULT_START_HOUR), timeOfDay(DEFAULT_END_HOUR)],
  };
}

export function setOperator(
  value: TimeOfDayPickerValue,
  operator: TimeOfDayPickerOperator,
): TimeOfDayPickerValue {
  const defaultValues = getDefaultValue().values;
  const values = Array.from(
    { length: getValueCount(operator) },
    (_, index) => value.values[index] ?? defaultValues[index],
  );

  return { ...value, operator, values };
}

export function setTime(
  value: TimeOfDayPickerValue,
  index: number,
  time: Date,
): TimeOfDayPickerValue {
  const values = [...value.values];
  values[index] = time;
  return { ...value, values };
}
