import Color from "color";

import { getSafeColor } from "metabase/ui/colors/safe-color";
import { parseHashOptions } from "metabase/utils/browser";
import type { ColorSettings } from "metabase-types/api";

/**
 * Colors that URL hash parameters may override in static and public embeds, e.g.
 *
 *   /embed/dashboard/TOKEN#primary-color=%23FF5733&card-bg-color=%23FAFAFA
 *
 * Values may be hex (3, 6 or 8 digits) or a functional notation carrying an alpha
 * channel, e.g. `background-color=rgba(255%2C0%2C0%2C0.5)`.
 *
 * Each parameter is accepted in both its hyphenated and underscored spelling.
 *
 * `dashboard-bg-color` and `card-bg-color` are not palette colors: they map to
 * component theme values (`--mb-color-bg-dashboard`, `--mb-color-bg-dashboard-card`
 * and `--mb-color-bg-question`), so they are returned separately from `colors`.
 *
 * Note that a question embed paints its content area with `--mb-color-bg-dashboard`,
 * so `dashboard-bg-color` — not `card-bg-color` — is what changes it.
 */
const PALETTE_COLOR_PARAMS = {
  // Cascades to `core-brand` and, through it, to the whole brand ramp:
  // hovers, selected states, brand surfaces and brand borders.
  "primary-color": ["brand"],
  "secondary-color": [
    "background-disabled",
    "background_surface-disabled",
    "switch-off",
  ],
  "background-color": ["background_page-primary", "background-primary"],
  "text-primary-color": ["text-primary"],
  "text-secondary-color": ["text-secondary"],
  "border-color": ["border", "border-neutral"],
} as const;

const DASHBOARD_BG_PARAM = "dashboard-bg-color";
const CARD_BG_PARAM = "card-bg-color";

const HEX_COLOR_REGEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Guards the `color` parser so that only functional color notations reach it,
 * rather than any string it happens to accept. Note that `color` understands the
 * legacy comma syntax — `rgba(255, 0, 0, 0.5)` — but not the modern
 * space-separated one, `rgb(255 0 0 / 50%)`.
 */
const FUNCTIONAL_COLOR_REGEX = /^(rgb|rgba|hsl|hsla)\(/i;

export type EmbedColorOverrides = {
  /** Palette colors, to be merged into whitelabel color settings. */
  colors: ColorSettings;
  /** Maps to `theme.other.dashboard.backgroundColor`. */
  dashboardBackgroundColor?: string;
  /** Maps to `theme.other.dashboard.card.backgroundColor` and `theme.other.question.backgroundColor`. */
  cardBackgroundColor?: string;
};

/**
 * Normalizes a functional color notation to `rgba(r, g, b, a)`, which both CSS
 * and the downstream `Color` operations handle. Returns `null` when the value
 * cannot be parsed, so a malformed color is ignored rather than raising.
 */
function readFunctionalColor(rawColor: string): string | null {
  try {
    return getSafeColor(Color(rawColor).rgb().string());
  } catch (e) {
    return null;
  }
}

/**
 * Reads a color from a hash option, returning `null` when it is missing or is
 * not a color we accept. `parseHashOptions` coerces all-digit values to numbers,
 * so values are stringified before being validated.
 */
function readColor(value: unknown): string | null {
  if (value == null || typeof value === "boolean" || Array.isArray(value)) {
    return null;
  }

  const rawColor = String(value);

  if (FUNCTIONAL_COLOR_REGEX.test(rawColor)) {
    return readFunctionalColor(rawColor);
  }

  if (!HEX_COLOR_REGEX.test(rawColor)) {
    return null;
  }

  return rawColor.startsWith("#") ? rawColor : `#${rawColor}`;
}

/** Looks a parameter up in both its hyphenated and underscored spelling. */
function readColorParam(
  hashOptions: Record<string, unknown>,
  param: string,
): string | null {
  return (
    readColor(hashOptions[param]) ??
    readColor(hashOptions[param.replace(/-/g, "_")])
  );
}

/**
 * Parses color overrides out of an embed URL hash. Invalid or unknown values
 * are ignored rather than raising, so a malformed parameter can never break an
 * embed. Returns `null` when the hash carries no usable color, which lets
 * callers skip theme merging entirely.
 */
export function parseEmbedColorOverrides(
  hash: string,
): EmbedColorOverrides | null {
  const hashOptions = parseHashOptions(hash);

  const colors: ColorSettings = {};

  for (const [param, colorKeys] of Object.entries(PALETTE_COLOR_PARAMS)) {
    const color = readColorParam(hashOptions, param);

    if (color != null) {
      for (const colorKey of colorKeys) {
        colors[colorKey] = color;
      }
    }
  }

  const dashboardBackgroundColor = readColorParam(
    hashOptions,
    DASHBOARD_BG_PARAM,
  );
  const cardBackgroundColor = readColorParam(hashOptions, CARD_BG_PARAM);

  const hasOverrides =
    Object.keys(colors).length > 0 ||
    dashboardBackgroundColor != null ||
    cardBackgroundColor != null;

  if (!hasOverrides) {
    return null;
  }

  return {
    colors,
    ...(dashboardBackgroundColor != null && { dashboardBackgroundColor }),
    ...(cardBackgroundColor != null && { cardBackgroundColor }),
  };
}
