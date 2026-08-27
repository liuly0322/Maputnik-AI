import {describe, expect, it} from "vitest";

import {buildAgentInstructions, createUserInputItem, runJavascriptToolDefinition} from "./agent-client";

describe("buildAgentInstructions", () => {
  it("tells the model how to access dataset rows and columns", () => {
    const instructions = buildAgentInstructions({
      viewport: {
        center: [0, 0],
        zoom: 1,
        bearing: 0,
        pitch: 0,
        bounds: {west: -1, south: -1, east: 1, north: 1},
      },
      style: {},
      layers: [],
      sources: {},
      selectedLayerIndex: 0,
      selectedLayer: undefined,
      selection: [],
      datasets: [
        {
          id: "ds1",
          name: "places",
          columns: ["name", "lon", "lat"],
          rowCount: 2,
          createdAt: 0,
        },
      ],
    } as any);

    expect(instructions).toContain("runtime.datasets.get(ds.id)");
    expect(instructions).toContain("runtime.datasets.query");
    expect(instructions).toContain("runtime.datasets.toGeoJSON");
    expect(instructions).toContain("run_javascript is your JavaScript evaluation environment");
    expect(instructions).toContain("instead of estimating from memory");
    expect(instructions).toContain("An overlay layer visualizes, colors, filters, or otherwise encodes any user-provided dataset");
    expect(instructions).toContain("automatically adds the agent-dataset: prefix and metadata maputnik:role=overlay");
    expect(instructions).toContain("verify every such layer has the agent-dataset: prefix or maputnik:role=overlay");
  });

  it("only includes selected datasets in the context", () => {
    const snapshot: any = {
      viewport: {
        center: [0, 0],
        zoom: 1,
        bearing: 0,
        pitch: 0,
        bounds: {west: -1, south: -1, east: 1, north: 1},
      },
      style: {},
      layers: [],
      sources: {},
      selectedLayerIndex: 0,
      selectedLayer: undefined,
      selection: [],
      datasets: [
        {id: "one", name: "one", columns: [], rowCount: 1, rows: [], createdAt: 0},
        {id: "two", name: "two", columns: [], rowCount: 2, rows: [], createdAt: 0},
      ],
    };

    const instructions = buildAgentInstructions(snapshot, ["two"]);
    expect(instructions).toContain("two");
    expect(instructions).not.toContain("one:");
  });
});

describe("createUserInputItem", () => {
  it("includes images as input_image content parts", () => {
    const item = createUserInputItem("What is this?", ["data:image/png;base64,abc"]);
    expect(item.content).toEqual([
      {type: "input_text", text: "What is this?"},
      {type: "input_image", image_url: "data:image/png;base64,abc"},
    ]);
  });
});

describe("runJavascriptToolDefinition", () => {
  it("tells the model to run code for calculations instead of estimating", () => {
    const tool = runJavascriptToolDefinition();
    expect(tool.description).toContain("instead of estimating");
  });
});
