import {describe, expect, it} from "vitest";

import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
} from "./agent-overlay";
import {createExportVisibilityPlan} from "./agent-export";

const layers = [
  {id: "background"},
  {id: "water", layout: {visibility: "none" as const}},
  {id: `${AGENT_OVERLAY_LAYER_PREFIX}points`, layout: {visibility: "visible" as const}},
  {
    id: "highlights",
    metadata: {[AGENT_OVERLAY_METADATA_KEY]: AGENT_OVERLAY_ROLE},
    layout: {visibility: "none" as const},
  },
];

describe("agent-export", () => {
  it("creates a base export plan for both overlay markers", () => {
    const plan = createExportVisibilityPlan(layers, "base");

    expect(plan.hide).toEqual([
      `${AGENT_OVERLAY_LAYER_PREFIX}points`,
      "highlights",
    ]);
    expect(plan.restore).toEqual([
      {id: "background", visibility: "visible"},
      {id: "water", visibility: "none"},
      {id: `${AGENT_OVERLAY_LAYER_PREFIX}points`, visibility: "visible"},
      {id: "highlights", visibility: "none"},
    ]);
  });

  it("creates an overlay export plan that hides base layers", () => {
    const plan = createExportVisibilityPlan(layers, "overlay");

    expect(plan.hide).toEqual(["background", "water"]);
  });
});
