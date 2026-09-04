import type { MantineTheme } from "metabase/ui";

import {
  getCellBackgroundColor,
  getCellHoverBackground,
  getCellTextColor,
} from "./cell-colors";

/**
 * Colors as a themed embed would define them: they live on the theme and in the
 * `--mb-color-*` variables, but never in the palette of `metabase/ui/colors`.
 * Anything resolved from that palette here would come back as an instance
 * default instead, which is what used to leave pivot cells white.
 */
const EMBED_COLORS: Record<string, string> = {
  "border-neutral": "rgb(71, 71, 73)",
  "background_page-primary": "rgb(24, 24, 27)",
  "text-disabled": "rgb(82, 82, 91)",
};

interface ThemeOpts {
  colorScheme?: "light" | "dark";
  cellBackgroundColor?: string;
  cellTextColor?: string;
}

const createTheme = ({
  colorScheme = "light",
  cellBackgroundColor,
  cellTextColor = "var(--mb-color-text-primary)",
}: ThemeOpts = {}) =>
  ({
    other: {
      colorScheme,
      table: {
        cell: {
          textColor: cellTextColor,
          backgroundColor: cellBackgroundColor,
        },
      },
    },
    fn: { themeColor: (name: string) => EMBED_COLORS[name] ?? name },
  }) as unknown as MantineTheme;

describe("PivotTable cell colors", () => {
  describe("getCellBackgroundColor", () => {
    it("paints body cells with the page background variable so embed colors apply", () => {
      expect(getCellBackgroundColor({ theme: createTheme() })).toBe(
        "var(--mb-color-background_page-primary)",
      );
    });

    it("derives the emphasized cell background from the theme's border color", () => {
      expect(
        getCellBackgroundColor({ theme: createTheme(), isEmphasized: true }),
      ).toBe("rgba(71, 71, 73, 0.25)");
    });

    it("prefers an explicit table cell background over the variable", () => {
      const theme = createTheme({ cellBackgroundColor: "rgb(1, 2, 3)" });

      expect(getCellBackgroundColor({ theme })).toBe("rgb(1, 2, 3)");
    });

    it("keeps transparent cells transparent", () => {
      expect(
        getCellBackgroundColor({ theme: createTheme(), isTransparent: true }),
      ).toBe("transparent");
    });
  });

  describe("getCellHoverBackground", () => {
    it("falls back to the border color variable when the table has no cell background", () => {
      expect(getCellHoverBackground({ theme: createTheme() })).toBe(
        "var(--mb-color-border-neutral)",
      );
    });

    it("brightens an explicit cell background", () => {
      const theme = createTheme({ cellBackgroundColor: "rgb(20, 20, 22)" });

      expect(getCellHoverBackground({ theme })).not.toBe("rgb(20, 20, 22)");
    });
  });

  describe("getCellTextColor", () => {
    it.each(["light", "dark"] as const)(
      "uses the table cell text color in the %s scheme",
      (colorScheme) => {
        expect(getCellTextColor({ theme: createTheme({ colorScheme }) })).toBe(
          "var(--mb-color-text-primary)",
        );
      },
    );

    it("turns a palette name into its css variable", () => {
      const theme = createTheme({ cellTextColor: "text-secondary" });

      expect(getCellTextColor({ theme })).toBe("var(--mb-color-text-secondary)");
    });
  });
});
