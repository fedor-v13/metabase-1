import type { PublicEmbeddingTheme } from "metabase-types/api";

import {
  findSavedTheme,
  savedThemeToPaletteOverrides,
  slugifyThemeName,
} from "./saved-themes";

const themes: PublicEmbeddingTheme[] = [
  { name: "Corporate Blue", settings: { colors: { brand: "#3498db" } } },
  { name: "Nature Green", settings: { preset: "dark", colors: {} } },
];

describe("slugifyThemeName", () => {
  it.each([
    ["Corporate Blue", "corporate-blue"],
    ["  Nature   Green  ", "nature-green"],
    ["Café Ünicode!", "caf-nicode"],
    ["Already-Hyphenated", "already-hyphenated"],
    ["--Trimmed--", "trimmed"],
    ["!!!", ""],
  ])("slugifies %p to %p", (name, slug) => {
    expect(slugifyThemeName(name)).toBe(slug);
  });
});

describe("findSavedTheme", () => {
  it("matches on the slug of the theme name", () => {
    expect(findSavedTheme(themes, "corporate-blue")?.name).toBe(
      "Corporate Blue",
    );
  });

  it("returns null for built-in themes so they keep their own behavior", () => {
    for (const builtIn of ["light", "night", "dark", "transparent"]) {
      expect(findSavedTheme(themes, builtIn)).toBeNull();
    }
  });

  it("returns null for unknown, empty and non-string values", () => {
    expect(findSavedTheme(themes, "does-not-exist")).toBeNull();
    expect(findSavedTheme(themes, undefined)).toBeNull();
    // a bare `#theme` is parsed as `true`
    expect(findSavedTheme(themes, true)).toBeNull();
    expect(findSavedTheme(null, "corporate-blue")).toBeNull();
    expect(findSavedTheme([], "corporate-blue")).toBeNull();
  });

  it("never matches a theme whose name slugifies to nothing", () => {
    expect(findSavedTheme([{ name: "!!!", settings: {} }], "")).toBeNull();
  });
});

describe("savedThemeToPaletteOverrides", () => {
  it("returns an empty object when there is nothing to apply", () => {
    expect(savedThemeToPaletteOverrides(null)).toEqual({});
    expect(savedThemeToPaletteOverrides({})).toEqual({});
    expect(savedThemeToPaletteOverrides({ preset: "dark" })).toEqual({});
  });

  it("fans an SDK color out to every main app color it maps to", () => {
    expect(savedThemeToPaletteOverrides({ colors: { brand: "#3498db" } })).toEqual(
      { brand: "#3498db", "core-brand": "#3498db" },
    );

    expect(savedThemeToPaletteOverrides({ colors: { border: "#E0E0E0" } })).toEqual(
      { border: "#E0E0E0", "border-neutral": "#E0E0E0" },
    );
  });

  it("stays sparse, so it can be merged over a light or dark palette", () => {
    const overrides = savedThemeToPaletteOverrides({
      colors: { "text-primary": "#2C3E50" },
    });

    expect(overrides).toEqual({ "text-primary": "#2C3E50" });
    expect(overrides).not.toHaveProperty("background_page-primary");
  });

  it("fills background-secondary from background when it is not set", () => {
    const overrides = savedThemeToPaletteOverrides({
      colors: { background: "#FFFFFF" },
    });

    expect(overrides["background_page-primary"]).toBe("#FFFFFF");
    expect(overrides["background_page-secondary"]).toBe("#FFFFFF");
  });

  it("does not override an explicit background-secondary", () => {
    const overrides = savedThemeToPaletteOverrides({
      colors: { background: "#FFFFFF", "background-secondary": "#EEEEEE" },
    });

    expect(overrides["background_page-primary"]).toBe("#FFFFFF");
    expect(overrides["background_page-secondary"]).toBe("#EEEEEE");
  });

  it("ignores chart colors, which are not applied yet", () => {
    expect(
      savedThemeToPaletteOverrides({
        colors: { charts: ["#111111", "#222222"] },
      }),
    ).toEqual({});
  });

  it("ignores unknown color keys instead of throwing", () => {
    expect(
      savedThemeToPaletteOverrides({
        colors: { "not-a-color": "#FF0000" },
      } as never),
    ).toEqual({});
  });
});
