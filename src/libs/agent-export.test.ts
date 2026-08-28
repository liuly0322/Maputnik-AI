import {describe, expect, it} from "vitest";

import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
} from "./agent-overlay";
import {
  createExportVisibilityPlan,
  isAgentOverlayLayerId,
  isAgentOverlayLayer,
  layerVisibility,
} from "./agent-export";

const layers = [
  {id: "background"},
  {id: "water", layout: {visibility: "none" as const}},
  {id: `${AGENT_OVERLAY_LAYER_PREFIX}points`, layout: {visibility: "visible" as const}},
  {id: `${AGENT_OVERLAY_LAYER_PREFIX}heatmap`, layout: {visibility: "none" as const}},
];

describe("agent-export", () => {
  it("identifies overlay layers by the agent-dataset prefix", () => {
    expect(isAgentOverlayLayerId("background")).toBe(false);
    expect(isAgentOverlayLayerId(`${AGENT_OVERLAY_LAYER_PREFIX}points`)).toBe(true);
  });

  it("identifies overlay layers by metadata role as a fallback", () => {
    expect(isAgentOverlayLayer({
      id: "street-coloring",
      metadata: {[AGENT_OVERLAY_METADATA_KEY]: AGENT_OVERLAY_ROLE},
    })).toBe(true);
    expect(isAgentOverlayLayer({id: "street-coloring"})).toBe(false);
  });

  it("derives a layer visibility default of visible", () => {
    expect(layerVisibility({id: "background"})).toBe("visible");
    expect(layerVisibility({id: "hidden", layout: {visibility: "none"}})).toBe("none");
  });

  it("hides only overlays for a base export and preserves original states for restore", () => {
    const plan = createExportVisibilityPlan(layers, "base");

    expect(plan.hide).toEqual([
      `${AGENT_OVERLAY_LAYER_PREFIX}points`,
      `${AGENT_OVERLAY_LAYER_PREFIX}heatmap`,
    ]);
    expect(plan.restore).toEqual([
      {id: "background", visibility: "visible"},
      {id: "water", visibility: "none"},
      {id: `${AGENT_OVERLAY_LAYER_PREFIX}points`, visibility: "visible"},
      {id: `${AGENT_OVERLAY_LAYER_PREFIX}heatmap`, visibility: "none"},
    ]);
  });

  it("uses metadata-only overlay layers in visibility plans", () => {
    const plan = createExportVisibilityPlan([
      {id: "background"},
      {
        id: "street-coloring",
        metadata: {[AGENT_OVERLAY_METADATA_KEY]: AGENT_OVERLAY_ROLE},
      },
    ], "base");

    expect(plan.hide).toEqual(["street-coloring"]);
  });

  it("hides only non-overlays for an overlay export and preserves original states for restore", () => {
    const plan = createExportVisibilityPlan(layers, "overlay");

    expect(plan.hide).toEqual(["background", "water"]);
    expect(plan.restore).toEqual([
      {id: "background", visibility: "visible"},
      {id: "water", visibility: "none"},
      {id: `${AGENT_OVERLAY_LAYER_PREFIX}points`, visibility: "visible"},
      {id: `${AGENT_OVERLAY_LAYER_PREFIX}heatmap`, visibility: "none"},
    ]);
  });
});
