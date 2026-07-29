import { parseHashOptions } from "metabase/utils/browser";
import type { ColorSettings } from "metabase-types/api";

/**
 * Colors that URL hash parameters may override in static and public embeds, e.g.
 *
 *   /embed/dashboard/TOKEN#primary-color=%23FF5733&card-bg-color=%23FAFAFA
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
 * The old fork treated pure black as a request for a transparent background, so
 * that embeds could be dropped onto any page. Kept for backward compatibility.
 */
const TRANSPARENT_ALIASES = ["#000", "#000000"];

export type EmbedColorOverrides = {
  /** Palette colors, to be merged into whitelabel color settings. */
  colors: ColorSettings;
  /** Maps to `theme.other.dashboard.backgroundColor`. */
  dashboardBackgroundColor?: string;
  /** Maps to `theme.other.dashboard.card.backgroundColor` and `theme.other.question.backgroundColor`. */
  cardBackgroundColor?: string;
};

/**
 * Reads a color from a hash option, returning `null` when it is missing or is
 * not a hex color. `parseHashOptions` coerces all-digit values to numbers, so
 * values are stringified before being validated.
 */
function readColor(value: unknown): string | null {
  if (value == null || typeof value === "boolean" || Array.isArray(value)) {
    return null;
  }

  const rawColor = String(value);
  if (!HEX_COLOR_REGEX.test(rawColor)) {
    return null;
  }

  const color = rawColor.startsWith("#") ? rawColor : `#${rawColor}`;

  return TRANSPARENT_ALIASES.includes(color.toLowerCase())
    ? "transparent"
    : color;
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
