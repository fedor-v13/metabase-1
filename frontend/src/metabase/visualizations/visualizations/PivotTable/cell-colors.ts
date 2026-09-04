import type { MantineTheme } from "metabase/ui";
import { adjustBrightness, alpha, color } from "metabase/ui/colors";
import { maybeColor } from "metabase/ui/utils/colors";

export interface PivotTableCellProps {
  isBold?: boolean;
  isEmphasized?: boolean;
  isBorderedHeader?: boolean;
  hasTopBorder?: boolean;
  isTransparent?: boolean;
}

type CellColorProps = Partial<PivotTableCellProps> & { theme: MantineTheme };

/**
 * Resolves a palette key through the theme rather than through the palette in
 * `metabase/ui/colors`, which is built once at page load and only refreshed from
 * the appearance settings. Colors a static or public embed passes in its URL
 * hash reach the theme and the `--mb-color-*` variables, never that palette, so
 * reading from it paints an embed with the instance's default colors.
 */
export const resolveThemeColor = (theme: MantineTheme, colorName: string) =>
  theme.fn.themeColor(colorName);

export const getCellBackgroundColor = ({
  theme,
  isEmphasized,
  isTransparent,
}: CellColorProps) => {
  const backgroundColor = theme.other.table.cell.backgroundColor;
  const isDarkMode = theme.other.colorScheme === "dark";

  if (isTransparent) {
    return "transparent";
  }

  if (isEmphasized) {
    // The dark branches below read the *light* palette's inverse tokens on
    // purpose: those are the ones that read as dark. Resolving them against the
    // theme would flip them to light colors in a dark scheme.
    if (isDarkMode) {
      return color("background_page-primary-inverse");
    }

    if (backgroundColor) {
      return adjustBrightness(backgroundColor, 0.15, 0.05);
    }

    return alpha(resolveThemeColor(theme, "border-neutral"), 0.25);
  }

  if (isDarkMode) {
    return alpha("background_page-primary-inverse", 0.1);
  }

  return backgroundColor ?? "var(--mb-color-background_page-primary)";
};

export const getCellHoverBackground = (props: CellColorProps) => {
  const { cell: cellTheme } = props.theme.other.table;

  if (!cellTheme.backgroundColor) {
    return "var(--mb-color-border-neutral)";
  }

  return adjustBrightness(getCellBackgroundColor(props), 0.15, 0.1);
};

/**
 * `--mb-color-text-primary` already flips with the color scheme, so both schemes
 * share the same value and a `text-primary-color` embed override applies to
 * either one.
 */
export const getCellTextColor = ({ theme }: CellColorProps) =>
  maybeColor(theme.other.table.cell.textColor);
