import type {
  TimeOfDayPickerOperator,
  TimeOfDayPickerValue,
} from "metabase/querying/common/types";

export interface TimeOfDayTab {
  label: string;
  operator: TimeOfDayPickerOperator;
}

export type TimeOfDayPickerSubmitButtonProps = {
  value: TimeOfDayPickerValue;
  isDisabled?: boolean;
};
