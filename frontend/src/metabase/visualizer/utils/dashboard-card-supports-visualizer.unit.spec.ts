import { registerVisualizations } from "metabase/visualizations/register";

import {
  isDisabledForVisualizer,
  isVisualizerSupportedVisualization,
} from "./dashboard-card-supports-visualizer";

registerVisualizations();

describe("isDisabledForVisualizer", () => {
  it("disables the visualizer for custom visualizations, loaded or not", () => {
    // Not registered in this test, so the registry falls back to Table —
    // exactly the state a dashboard is in before the plugin bundle loads.
    expect(isDisabledForVisualizer("custom:aibi-pivot-table")).toBe(true);
    expect(isVisualizerSupportedVisualization("custom:aibi-pivot-table")).toBe(
      false,
    );
  });

  it("still disables it for built-ins that opt out (metabase#65317)", () => {
    expect(isDisabledForVisualizer("sankey")).toBe(true);
  });

  it("leaves built-in displays that support it alone", () => {
    expect(isDisabledForVisualizer("bar")).toBeFalsy();
    expect(isDisabledForVisualizer("table")).toBeFalsy();
  });
});
