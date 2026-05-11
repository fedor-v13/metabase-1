// WARNING: This file is referenced by CssVarsDeclarationPlugin.
// If you move or rename it, update the path in css-vars-declaration-plugin.js.

// eslint-disable-next-line no-restricted-imports
import { css } from "@emotion/react";
import { getIn } from "icepick";

import { CSS_VARIABLES_TO_SDK_THEME_MAP } from "metabase/embedding-sdk/theme/css-vars-to-sdk-theme";
import { getDynamicCssVariables } from "metabase/embedding-sdk/theme/dynamic-css-vars";
import {
  SDK_TO_MAIN_APP_COLORS_MAPPING,
  SDK_TO_MAIN_APP_TOOLTIP_COLORS_MAPPING,
  SDK_UNCHANGEABLE_COLORS,
} from "metabase/embedding-sdk/theme/embedding-color-palette";
import type { ResolvedColorScheme } from "metabase/lib/color-scheme";
import type { MantineTheme } from "metabase/ui";
import { deriveFullMetabaseTheme } from "metabase/ui/colors";
import type { ColorSettings } from "metabase-types/api";

const createColorVars = (
  colorScheme: ResolvedColorScheme,
  whitelabelColors?: ColorSettings | null,
): string => {
  const theme = deriveFullMetabaseTheme({
    colorScheme,
    whitelabelColors,
  });

  return Object.entries(theme.colors)
    .map(([name, value]) => `--mb-color-${name}: ${value};`)
    .join("\n");
};

/**
 * Defines the CSS variables used across Metabase.
 */
export function getMetabaseCssVariables({
  theme,
  whitelabelColors,
}: {
  theme: MantineTheme;
  whitelabelColors?: ColorSettings | null;
}) {
  const colorScheme = theme.other?.colorScheme || "light";

  return css`
    :root {
      --mb-default-monospace-font-family: ${theme.fontFamilyMonospace};

      /* Semantic colors */
      ${createColorVars(colorScheme, whitelabelColors)}
      ${getThemeSpecificCssVariables(theme)}
      ${getDynamicCssVariables(theme)}
    }
  `;
}

export function getMetabaseSdkCssVariables({
  theme,
  font,
  whitelabelColors,
}: {
  theme: MantineTheme;
  font: string;
  whitelabelColors?: ColorSettings | null;
}) {
  return css`
    :root {
      --mb-default-font-family: ${font};
      ${createMergedSdkColorVars(theme, whitelabelColors)}
      ${getDynamicCssVariables(theme)}
      ${getThemeSpecificCssVariables(theme)}
    }
  `;
}

/**
 * Generates a single, merged set of CSS color variable declarations for the SDK.
 *
 * Instead of generating base light-theme colors first and then trying to override
 * them with SDK theme colors via CSS declaration ordering (which can be unreliable
 * with Emotion's css template literal processing of mixed string/object interpolations),
 * this function merges all colors in JavaScript first and produces one declaration per variable.
 *
 * Priority: base light theme < whitelabel colors < SDK theme overrides from Mantine theme
 */
function createMergedSdkColorVars(
  theme: MantineTheme,
  whitelabelColors?: ColorSettings | null,
): string {
  // 1. Start with the full set of base light theme colors (includes computed colors like color-mix())
  const baseColors = deriveFullMetabaseTheme({
    colorScheme: "light",
    whitelabelColors,
  }).colors;

  // 2. Build SDK overrides from the Mantine theme (which already has SDK colors merged in)
  const sdkOverrides: Record<string, string> = {};

  // SDK-mappable colors
  for (const colorNames of Object.values(SDK_TO_MAIN_APP_COLORS_MAPPING)) {
    for (const colorName of colorNames) {
      const color = theme.fn.themeColor(colorName);
      if (color !== colorName) {
        sdkOverrides[colorName] = color;
      }
    }
  }

  // SDK tooltip colors
  for (const colorName of Object.values(
    SDK_TO_MAIN_APP_TOOLTIP_COLORS_MAPPING,
  )) {
    const color = theme.fn.themeColor(colorName);
    if (color !== colorName) {
      sdkOverrides[colorName] = color;
    }
  }

  // Unchangeable colors
  for (const colorName of SDK_UNCHANGEABLE_COLORS) {
    const color = theme.fn.themeColor(colorName);
    if (color !== colorName) {
      sdkOverrides[colorName] = color;
    }
  }

  // 3. Merge: SDK overrides win over base colors
  const mergedColors: Record<string, string> = {
    ...baseColors,
    ...sdkOverrides,
  };

  return Object.entries(mergedColors)
    .map(([name, value]) => `--mb-color-${name}: ${value};`)
    .join("\n");
}

/**
 * Theming-specific CSS variables.
 *
 * These CSS variables are NOT part of the core design system colors.
 * Do NOT add them to [palette.ts] and [colors.ts].
 *
 * Keep in sync with [GlobalStyles.tsx].
 * Refer to DEFAULT_METABASE_COMPONENT_THEME for their defaults.
 **/
export const getThemeSpecificCssVariables = (theme: MantineTheme) => css`
  ${Object.entries(CSS_VARIABLES_TO_SDK_THEME_MAP)
    .map(([cssVar, themeKey]) => {
      const value = getIn(theme.other, themeKey.split("."));

      return value ? `${cssVar}: ${value};` : "";
    })
    .join("\n")}
`;
