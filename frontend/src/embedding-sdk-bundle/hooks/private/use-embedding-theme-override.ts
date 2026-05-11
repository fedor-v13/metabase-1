import { useMemo } from "react";

import { DEFAULT_FONT } from "embedding-sdk-bundle/config";
import { getEmbeddingThemeOverride } from "embedding-sdk-bundle/lib/theme";
import { applyThemePreset } from "embedding-sdk-shared/lib/apply-theme-preset";
import { useSetting } from "metabase/common/hooks";
import {
  type MetabaseEmbeddingTheme,
  getEmbeddingComponentOverrides,
  isEmbeddingThemeV1,
  isEmbeddingThemeV2,
} from "metabase/embedding-sdk/theme";
import { setGlobalEmbeddingColors } from "metabase/embedding-sdk/theme/embedding-color-palette";
import { useSelector } from "metabase/lib/redux";
import { getFont } from "metabase/styled-components/selectors";
import type { MantineThemeOverride } from "metabase/ui";
import { deriveFullMetabaseTheme } from "metabase/ui/colors";
import { getColorShades } from "metabase/ui/utils/colors";

/**
 * Returns the Mantine theme override for modular embedding.
 */
export function useEmbeddingThemeOverride(
  theme?: MetabaseEmbeddingTheme,
): MantineThemeOverride | undefined {
  const font = useSelector(getFont);
  const appColors = useSetting("application-colors");

  return useMemo(() => {
    if (!theme || isEmbeddingThemeV1(theme)) {
      const themeWithPreset = applyThemePreset(theme);

      console.log("[useEmbeddingThemeOverride] theme input:", JSON.stringify(theme));
      console.log("[useEmbeddingThemeOverride] themeWithPreset:", JSON.stringify(themeWithPreset));
      console.log("[useEmbeddingThemeOverride] themeWithPreset?.colors:", JSON.stringify(themeWithPreset?.colors));

      // !! Mutate the global colors object to apply the new colors.
      // This must be done before ThemeProvider calls getThemeOverrides.
      setGlobalEmbeddingColors(themeWithPreset?.colors, appColors ?? {});

      const override = getEmbeddingThemeOverride(
        themeWithPreset || {},
        font,
        appColors ?? {},
      );
      console.log("[useEmbeddingThemeOverride] override.colors keys:", override.colors ? Object.keys(override.colors) : "none");
      return override;
    }

    // We must include Modular Embedding specific overrides for portals (e.g. popover and modal) to target the correct portal id
    const components = getEmbeddingComponentOverrides();

    if (isEmbeddingThemeV2(theme)) {
      const derivedTheme = deriveFullMetabaseTheme({
        colorScheme: "light",
        whitelabelColors: appColors ?? {},
        embeddingThemeOverride: theme,
      });

      // Convert derived colors to Mantine color tuples
      const colors = Object.fromEntries(
        Object.entries(derivedTheme.colors).map(([key, value]) => [
          key,
          getColorShades(value),
        ]),
      );

      return { colors, fontFamily: font ?? DEFAULT_FONT, components };
    }

    // No theme provided: just return the component overrides for portals
    return { components };
  }, [appColors, theme, font]);
}
