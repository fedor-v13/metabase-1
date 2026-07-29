const { H } = cy;

/**
 * Themes are available on every plan in this fork: static and public embeds
 * resolve them through the public `embedding-themes` setting, and both the
 * editor route and `/api/embed-theme` are superuser-gated only.
 *
 * This replaces the upstream upsell spec, which asserted the opposite.
 */
describe("scenarios > embedding > themes > availability", () => {
  function assertThemeListingIsAvailable() {
    cy.visit("/admin/embedding/themes");

    cy.log("nav label has no upsell gem");
    cy.findByTestId("admin-layout-sidebar")
      .findByRole("link", { name: /Themes/ })
      .within(() => {
        cy.icon("gem").should("not.exist");
      });

    H.main().within(() => {
      cy.log("upsell copy is absent");
      cy.findByText("Metabase Pro").should("not.exist");
      cy.findByRole("heading", { name: "Create custom themes" }).should(
        "not.exist",
      );

      cy.log("theme listing is rendered");
      cy.findByRole("heading", { name: "Themes" }).should("be.visible");
      cy.findByRole("button", { name: /New theme/ }).should("be.visible");
    });
  }

  describe("OSS", { tags: "@OSS" }, () => {
    beforeEach(() => {
      H.restore();
      cy.signInAsAdmin();
    });

    it("renders the themes listing without an upsell", () => {
      assertThemeListingIsAvailable();
    });
  });

  describe("Starter", { tags: "@EE" }, () => {
    beforeEach(() => {
      H.restore();
      cy.signInAsAdmin();
      H.activateToken("starter");
    });

    it("renders the themes listing without an upsell", () => {
      assertThemeListingIsAvailable();
    });
  });

  describe("Pro", { tags: "@EE" }, () => {
    beforeEach(() => {
      H.restore();
      cy.signInAsAdmin();
      H.activateToken("pro-self-hosted");
    });

    it("renders the themes listing without an upsell", () => {
      assertThemeListingIsAvailable();
    });
  });
});
