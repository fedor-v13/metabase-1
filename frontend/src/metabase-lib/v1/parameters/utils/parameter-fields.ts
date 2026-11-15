import type Field from "metabase-lib/v1/metadata/Field";
import type {
  FieldFilterUiParameter,
  UiParameter,
} from "metabase-lib/v1/parameters/types";

export const isFieldFilterUiParameter = (
  parameter: UiParameter,
): parameter is FieldFilterUiParameter => {
  return "fields" in parameter && Array.isArray(parameter.fields);
};

export const hasFields = (parameter: UiParameter) => {
  return isFieldFilterUiParameter(parameter) && parameter.fields.length > 0;
};

export const getFields = (parameter: UiParameter): Field[] => {
  if (isFieldFilterUiParameter(parameter) && hasFields(parameter)) {
    return parameter.fields;
  } else {
    return [];
  }
};

export const getNonVirtualFields = (parameter: UiParameter) => {
  return getFields(parameter).filter((field) => !field.isVirtual());
};

/**
 * Whether every field this parameter is mapped to has a time of day, i.e. is a TIME or a DATETIME column and not a
 * date-only one. Filtering by time of day only means something for those.
 */
export const hasTimeOfDayFields = (parameter: UiParameter) => {
  const fields = getFields(parameter);
  return (
    fields.length > 0 &&
    fields.every((field) => field.isDate() && !field.isDateWithoutTime())
  );
};
