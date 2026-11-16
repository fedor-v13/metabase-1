import { useMemo, useState } from "react";
import { P, match } from "ts-pattern";
import { t } from "ttag";

import {
  DatePicker,
  TimeOfDayPicker,
} from "metabase/querying/common/components/DatePicker";
import type {
  DateFilterValue,
  DatePickerOperator,
  DatePickerShortcut,
  DatePickerValue,
  RelativeIntervalDirection,
  TimeOfDayPickerValue,
} from "metabase/querying/common/types";
import {
  deserializeDateParameterValue,
  serializeDateParameterValue,
} from "metabase/querying/parameters/utils/parsing";
import { Button } from "metabase/ui";
import type { ParameterValueOrArray } from "metabase-types/api";

type DateAllOptionsWidgetProps = {
  value: ParameterValueOrArray | null | undefined;
  availableOperators?: DatePickerOperator[];
  availableShortcuts?: DatePickerShortcut[];
  availableDirections?: RelativeIntervalDirection[];
  minDate?: Date;
  maxDate?: Date;
  submitButtonLabel?: string;
  /** Offer "Time of day", for parameters mapped to a column that has a time of day. */
  withTimeOfDay?: boolean;
  onChange: (value: string) => void;
};

export function DateAllOptionsWidget({
  value,
  availableOperators,
  availableDirections,
  minDate,
  maxDate,
  submitButtonLabel = t`Apply`,
  withTimeOfDay,
  onChange,
  availableShortcuts,
}: DateAllOptionsWidgetProps) {
  const filterValue = useMemo(
    () => deserializeDateParameterValue(value),
    [value],
  );
  const [isTimeOfDay, setIsTimeOfDay] = useState(
    filterValue?.type === "time-of-day",
  );

  const handleChange = (newValue: DateFilterValue) => {
    onChange(serializeDateParameterValue(newValue));
  };

  const renderSubmitButton = ({ isDisabled }: { isDisabled?: boolean }) => (
    <Button type="submit" variant="filled" disabled={isDisabled}>
      {submitButtonLabel}
    </Button>
  );

  if (isTimeOfDay) {
    return (
      <TimeOfDayPicker
        value={getTimeOfDayValue(filterValue)}
        renderSubmitButton={renderSubmitButton}
        onChange={handleChange}
        onBack={() => setIsTimeOfDay(false)}
      />
    );
  }

  return (
    <DatePicker
      value={getPickerValue(filterValue)}
      availableOperators={availableOperators}
      availableShortcuts={availableShortcuts}
      availableDirections={availableDirections}
      minDate={minDate}
      maxDate={maxDate}
      withTimeOfDay={withTimeOfDay}
      renderSubmitButton={renderSubmitButton}
      onChange={handleChange}
      onSelectTimeOfDay={() => setIsTimeOfDay(true)}
    />
  );
}

function getPickerValue(
  value: DateFilterValue | null,
): DatePickerValue | undefined {
  return match(value)
    .returnType<DatePickerValue | undefined>()
    .with(
      { type: P.union("specific", "relative", "exclude") },
      (value) => value,
    )
    .otherwise(() => undefined);
}

function getTimeOfDayValue(
  value: DateFilterValue | null,
): TimeOfDayPickerValue | undefined {
  return value?.type === "time-of-day" ? value : undefined;
}
