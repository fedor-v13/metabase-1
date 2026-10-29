import visualizations from "metabase/visualizations";
import type { VisualizationDisplay } from "metabase-types/api";
import { isCustomVizDisplay } from "metabase-types/guards";

export const DEFAULT_VISUALIZER_DISPLAY = "bar";

export function isVisualizerSupportedVisualization(
  display: VisualizationDisplay | null | undefined,
) {
  if (!display) {
    return false;
  }

  return visualizations.get(display)?.supportsVisualizer;
}

export function isDisabledForVisualizer(
  display: VisualizationDisplay | null | undefined,
) {
  if (!display) {
    return false;
  }

  // The visualizer can't express a custom visualization: its picker offers
  // only built-in displays, and saving rewrites the dashcard's settings while
  // the question keeps its custom display. The trip is one-way — there is no
  // path back to the plugin short of replacing the card. Checked on the display
  // string rather than a flag on the definition, because until the plugin's
  // bundle loads `visualizations.get` answers with the Table fallback.
  if (isCustomVizDisplay(display)) {
    return true;
  }

  return visualizations.get(display)?.disableVisualizer;
}
