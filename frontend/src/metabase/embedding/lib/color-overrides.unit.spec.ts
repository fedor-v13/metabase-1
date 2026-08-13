import { parseEmbedColorOverrides } from "./color-overrides";

describe("parseEmbedColorOverrides", () => {
  it("returns null when the hash carries no colors", () => {
    expect(parseEmbedColorOverrides("")).toBeNull();
    expect(parseEmbedColorOverrides("#theme=night&titled=true")).toBeNull();
  });

  it("parses percent-encoded and literal hashes the same way", () => {
    expect(parseEmbedColorOverrides("#primary-color=%23FF5733")?.colors).toEqual(
      { brand: "#FF5733" },
    );
    expect(parseEmbedColorOverrides("#primary-color=#FF5733")?.colors).toEqual({
      brand: "#FF5733",
    });
  });

  it("accepts underscored parameter names", () => {
    expect(parseEmbedColorOverrides("#text_primary_color=%232C3E50")).toEqual({
      colors: { "text-primary": "#2C3E50" },
    });
  });

  it("maps each parameter to its theme colors", () => {
    expect(
      parseEmbedColorOverrides(
        "#secondary-color=%234ECDC4&background-color=%23FFFFFF&border-color=%23E0E0E0",
      ),
    ).toEqual({
      colors: {
        "background-disabled": "#4ECDC4",
        "background_surface-disabled": "#4ECDC4",
        "switch-off": "#4ECDC4",
        "background_page-primary": "#FFFFFF",
        "background-primary": "#FFFFFF",
        border: "#E0E0E0",
        "border-neutral": "#E0E0E0",
      },
    });
  });

  it("returns the dashboard and card backgrounds separately", () => {
    expect(
      parseEmbedColorOverrides(
        "#dashboard-bg-color=%23FFFFFF&card-bg-color=%23FAFAFA",
      ),
    ).toEqual({
      colors: {},
      dashboardBackgroundColor: "#FFFFFF",
      cardBackgroundColor: "#FAFAFA",
    });
  });

  it("treats pure black as transparent", () => {
    expect(
      parseEmbedColorOverrides("#background-color=%23000000")?.colors,
    ).toEqual({
      "background_page-primary": "transparent",
      "background-primary": "transparent",
    });

    expect(parseEmbedColorOverrides("#card-bg-color=%23000")).toEqual({
      colors: {},
      cardBackgroundColor: "transparent",
    });
  });

  it("accepts 3, 6 and 8 digit hex colors", () => {
    expect(parseEmbedColorOverrides("#primary-color=%23F57")?.colors).toEqual({
      brand: "#F57",
    });
    expect(
      parseEmbedColorOverrides("#primary-color=%23FF573380")?.colors,
    ).toEqual({ brand: "#FF573380" });
  });

  it("accepts colors without a leading hash, including all-digit ones", () => {
    // `parseHashOptions` coerces all-digit values to numbers
    expect(parseEmbedColorOverrides("#primary-color=112233")?.colors).toEqual({
      brand: "#112233",
    });
    expect(parseEmbedColorOverrides("#primary-color=ff5733")?.colors).toEqual({
      brand: "#ff5733",
    });
  });

  it("accepts rgb, rgba and hsl colors, preserving the alpha channel", () => {
    expect(
      parseEmbedColorOverrides("#background-color=rgba(255,0,0,0.5)")?.colors,
    ).toEqual({
      "background_page-primary": "rgba(255, 0, 0, 0.5)",
      "background-primary": "rgba(255, 0, 0, 0.5)",
    });
    expect(
      parseEmbedColorOverrides("#primary-color=rgb(1,2,3)")?.colors,
    ).toEqual({ brand: "rgb(1, 2, 3)" });
    // percent signs must be encoded, as the hash is percent-decoded first
    expect(
      parseEmbedColorOverrides("#card-bg-color=hsla(0,100%25,50%25,0.25)"),
    ).toEqual({ colors: {}, cardBackgroundColor: "rgba(255, 0, 0, 0.25)" });
  });

  it("ignores invalid colors instead of throwing", () => {
    expect(parseEmbedColorOverrides("#primary-color=notacolor")).toBeNull();
    expect(
      parseEmbedColorOverrides("#primary-color=rgba(not,a,color)"),
    ).toBeNull();
    expect(parseEmbedColorOverrides("#primary-color=%23FF57")).toBeNull();
    expect(parseEmbedColorOverrides("#primary-color")).toBeNull();

    expect(
      parseEmbedColorOverrides("#primary-color=nope&border-color=%23E0E0E0"),
    ).toEqual({ colors: { border: "#E0E0E0", "border-neutral": "#E0E0E0" } });
  });

  it("ignores other embed display options", () => {
    expect(
      parseEmbedColorOverrides(
        "#theme=light&titled=true&bordered=false&primary-color=%23FF5733",
      ),
    ).toEqual({ colors: { brand: "#FF5733" } });
  });
});
