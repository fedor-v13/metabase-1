import _ from "underscore";

import type { ComponentProviderInternalProps } from "embedding-sdk-bundle/components/public/ComponentProvider";
import { useSdkSelector } from "embedding-sdk-bundle/store";
import { getHasTokenFeature } from "embedding-sdk-bundle/store/selectors";

export const useNormalizeComponentProviderProps = (
  props: ComponentProviderInternalProps,
): ComponentProviderInternalProps => {
  const hasTokenFeature = useSdkSelector(getHasTokenFeature);
  const normalizedProps = { ...props };

  console.log("[useNormalizeComponentProviderProps] hasTokenFeature:", hasTokenFeature);
  console.log("[useNormalizeComponentProviderProps] theme BEFORE normalization:", JSON.stringify(normalizedProps.theme));

  if (!hasTokenFeature) {
    // We prevent defining a locale
    delete normalizedProps.locale;

    // Allow theme preset AND colors for static/guest embeds
    if (normalizedProps.theme) {
      normalizedProps.theme = _.pick(normalizedProps.theme, "preset", "colors", "fontFamily", "fontSize", "lineHeight", "components");
    }
  }

  console.log("[useNormalizeComponentProviderProps] theme AFTER normalization:", JSON.stringify(normalizedProps.theme));

  return normalizedProps;
};
