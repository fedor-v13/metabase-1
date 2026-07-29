import type { MetabaseTheme } from "metabase/embedding-sdk/theme";
import {
  type MappableSdkColor,
  SDK_MISSING_COLORS_FALLBACK,
  SDK_TO_MAIN_APP_COLORS_MAPPING,
} from "metabase/embedding-sdk/theme/embedding-color-palette";
import { PROTECTED_COLORS } from "metabase/ui/colors/constants/protected-colors";
import type { ColorName } from "metabase/ui/colors/types";
import type { ColorSettings, PublicEmbeddingTheme } from "metabase-types/api";

// PROTECTED_COLORS is a readonly tuple of literals; widen it so it can be
// searched with an arbitrary color key.
const PROTECTED_COLOR_KEYS: readonly ColorName[] = PROTECTED_COLORS;

/**
 * Turns a theme's display name into the identifier used in embed URLs, so that
 * a theme named "Corporate Blue" is selected with `#theme=corporate-blue`.
 *
 * Note this is deliberately *not* `metabase.util/slugify`, which joins words
 * with underscores. Hyphens are what the pre-existing embed URLs use.
 */
export function slugifyThemeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Theme names reserved by the built-in display themes. */
const BUILT_IN_THEME_SLUGS = ["light", "night", "dark", "transparent"];

export function findSavedTheme(
  themes: PublicEmbeddingTheme[] | null | undefined,
  slug: unknown,
): PublicEmbeddingTheme | null {
  if (!themes?.length || typeof slug !== "string" || slug === "") {
    return null;
  }

  if (BUILT_IN_THEME_SLUGS.includes(slug)) {
    return null;
  }

  return themes.find((theme) => slugifyThemeName(theme.name) === slug) ?? null;
}

/**
 * Projects a saved theme's SDK-flavored colors onto main app color keys.
 *
 * The result is *sparse* — only the colors the theme actually sets. It gets
 * merged over the instance's whitelabel colors, so filling in the rest would
 * pin unrelated colors to a light palette and break dark themes.
 *
 * `theme.preset` is intentionally not expanded here: it selects the color
 * scheme instead (see `getColorSchemeFromDisplayTheme` in AppThemeProvider),
 * which yields the full light or dark palette rather than the nine keys
 * `applyThemePreset` covers.
 *
 * Chart colors (`colors.charts`) are not applied yet — see the note in
 * `frontend/src/metabase/embedding/lib/color-overrides.ts`.
 */
export function savedThemeToPaletteOverrides(
  theme: MetabaseTheme | null | undefined,
): ColorSettings {
  const themeColors = theme?.colors;

  if (!themeColors) {
    return {};
  }

  const overrides: ColorSettings = {};

  const setSdkColor = (sdkColor: MappableSdkColor, value: string) => {
    for (const colorKey of SDK_TO_MAIN_APP_COLORS_MAPPING[sdkColor] ?? []) {
      if (!PROTECTED_COLOR_KEYS.includes(colorKey)) {
        overrides[colorKey] = value;
      }
    }
  };

  for (const [sdkColor, value] of Object.entries(themeColors)) {
    if (sdkColor === "charts" || typeof value !== "string") {
      continue;
    }

    setSdkColor(sdkColor as MappableSdkColor, value);
  }

  // A theme that sets `background` but not `background-secondary` should not be
  // left with a mismatched secondary background.
  for (const [sdkColor, fallback] of Object.entries(
    SDK_MISSING_COLORS_FALLBACK,
  )) {
    const isMissing = themeColors[sdkColor as MappableSdkColor] == null;
    const fallbackValue = themeColors[fallback as MappableSdkColor];

    if (isMissing && typeof fallbackValue === "string") {
      setSdkColor(sdkColor as MappableSdkColor, fallbackValue);
    }
  }

  return overrides;
}
