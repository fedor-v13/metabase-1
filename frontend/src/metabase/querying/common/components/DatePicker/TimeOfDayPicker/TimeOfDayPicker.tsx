import { type FormEvent, type ReactNode, useState } from "react";
import { t } from "ttag";

import type { TimeOfDayPickerValue } from "metabase/querying/common/types";
import {
  Box,
  Divider,
  Flex,
  Group,
  PopoverBackButton,
  Tabs,
  Text,
  TimeInput,
} from "metabase/ui";

import { MIN_WIDTH } from "../constants";

import S from "./TimeOfDayPicker.module.css";
import { TABS } from "./constants";
import type { TimeOfDayPickerSubmitButtonProps } from "./types";
import { getDefaultValue, setOperator, setTime } from "./utils";

export type TimeOfDayPickerProps = {
  value?: TimeOfDayPickerValue;
  renderSubmitButton: (props: TimeOfDayPickerSubmitButtonProps) => ReactNode;
  onChange: (value: TimeOfDayPickerValue) => void;
  onBack: () => void;
  readOnly?: boolean;
};

export function TimeOfDayPicker({
  value: initialValue,
  renderSubmitButton,
  onChange,
  onBack,
  readOnly,
}: TimeOfDayPickerProps) {
  const [value, setValue] = useState(() => initialValue ?? getDefaultValue());
  const isRange = value.operator === "between";

  const handleTabChange = (tabValue: string | null) => {
    const tab = TABS.find((tab) => tab.operator === tabValue);
    if (tab) {
      setValue(setOperator(value, tab.operator));
    }
  };

  const handleStartTimeChange = (time: Date | null) => {
    if (time) {
      setValue(setTime(value, 0, time));
    }
  };

  const handleEndTimeChange = (time: Date | null) => {
    if (time) {
      setValue(setTime(value, 1, time));
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onChange(value);
  };

  return (
    <Box miw={MIN_WIDTH} data-testid="time-of-day-picker">
      <Tabs value={value.operator} onChange={handleTabChange}>
        <Flex>
          <PopoverBackButton
            p="sm"
            onClick={onBack}
            disabled={readOnly}
            withArrow={!readOnly}
          />
          <Tabs.List className={S.tabList}>
            {TABS.map((tab) => (
              <Tabs.Tab key={tab.operator} value={tab.operator}>
                {tab.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Flex>
        <Divider />
        {TABS.map((tab) => (
          <Tabs.Panel key={tab.operator} value={tab.operator}>
            <form onSubmit={handleSubmit}>
              <Flex p="md" align="center" gap="sm">
                <TimeInput
                  value={value.values[0]}
                  w="100%"
                  aria-label={isRange ? t`Start time` : t`Time`}
                  onChange={handleStartTimeChange}
                />
                {isRange && (
                  <>
                    <Text>{t`and`}</Text>
                    <TimeInput
                      value={value.values[1]}
                      w="100%"
                      aria-label={t`End time`}
                      onChange={handleEndTimeChange}
                    />
                  </>
                )}
              </Flex>
              <Divider />
              <Group p="sm" justify="flex-end">
                {renderSubmitButton({ value })}
              </Group>
            </form>
          </Tabs.Panel>
        ))}
      </Tabs>
    </Box>
  );
}
