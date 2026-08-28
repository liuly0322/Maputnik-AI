import {describe, expect, it} from "vitest";

import {
  buildAgentInstructions,
  createUserInputItem,
  DATASET_WORKFLOW_EXAMPLE,
  runJavascriptToolDefinition,
} from "./agent-client";
import {createAgentExecutionContext, executeAgentJavaScript} from "./agent-executor";
import {DATASET_TYPE_REFERENCE, type DatasetSummary} from "./dataset";
import {DatasetStore} from "./dataset-store";

const datasets: DatasetSummary[] = [
  {
    id: "places-2026",
    name: "places.csv",
    columns: ["name", "longitude", "latitude", "score"],
    rows: [],
    rowCount: 2,
    createdAt: 100,
  },
  {
    id: "stations-2026",
    name: "stations.csv",
    columns: ["station", "lon", "lat"],
    rows: [],
    rowCount: 5,
    createdAt: 200,
  },
];

describe("buildAgentInstructions", () => {
  it("describes the actual execution and dataset contracts", () => {
    const instructions = buildAgentInstructions(datasets);

    expect(instructions).toContain("provides three objects:");
    expect(instructions).toContain("- map: the live MapLibre Map instance.");
    expect(instructions).toContain("- style: a writable proxy");
    expect(instructions).toContain("- datasets: the browser-local CSV dataset workspace.");
    expect(instructions).toContain(DATASET_TYPE_REFERENCE);
    expect(instructions).toContain("End every execution with return.");
    expect(instructions).toContain("Set layer.id to a unique descriptive ID beginning with agent-dataset:.");
    expect(instructions).toContain("Set layer.metadata[\"maputnik:role\"] to \"overlay\".");
    expect(instructions).toContain(DATASET_WORKFLOW_EXAMPLE);
  });

  it("includes metadata for every loaded dataset without dynamic editor state", () => {
    const instructions = buildAgentInstructions(datasets);
    const catalog = JSON.parse(instructions.split("# Dataset catalog\n\n")[1]);

    expect(catalog).toEqual([
      {
        id: "places-2026",
        name: "places.csv",
        columns: ["name", "longitude", "latitude", "score"],
        rowCount: 2,
        createdAt: 100,
      },
      {
        id: "stations-2026",
        name: "stations.csv",
        columns: ["station", "lon", "lat"],
        rowCount: 5,
        createdAt: 200,
      },
    ]);
    const environmentObjects = Array.from(
      instructions.matchAll(/^- ([a-z]+):/gm),
      match => match[1]
    );
    expect(environmentObjects).toEqual(["map", "style", "datasets"]);
    expect(instructions).not.toMatch(/\bruntime\b/);
    expect(instructions).not.toMatch(/\blog\b/);
    expect(instructions).not.toContain("selectedLayer");
    expect(instructions).not.toContain("selection count");
    expect(instructions).not.toContain("Current live");
  });

  it("executes the shared dataset workflow example through the real executor", async () => {
    const store = new DatasetStore();
    const dataset = await store.addCsv(
      "values.csv",
      "place,longitude,latitude,score\nIncluded,120.5,30.25,20\nFiltered,121,31,5"
    );
    const style: any = {version: 8, sources: {}, layers: []};
    let committedStyle: any = style;
    const map: any = {
      getCenter: () => ({lng: 120, lat: 30}),
      getZoom: () => 6,
      getStyle: () => committedStyle,
    };
    const context = createAgentExecutionContext({
      getMap: () => map,
      getStyle: () => style,
      setStyle: nextStyle => {
        committedStyle = nextStyle;
      },
      datasets: store,
    });
    const code = DATASET_WORKFLOW_EXAMPLE
      .replace("<exact ID from the dataset catalog>", dataset.id)
      .replace('const longitudeColumn = "lon";', 'const longitudeColumn = "longitude";')
      .replace('const latitudeColumn = "lat";', 'const latitudeColumn = "latitude";')
      .replace('const valueColumn = "value";', 'const valueColumn = "score";');

    const output = JSON.parse(await executeAgentJavaScript(code, context));
    const sourceId = `agent-dataset:${dataset.id}:normalized-values`;
    const layerId = `agent-dataset:${dataset.id}:normalized-value-circles`;
    const source = committedStyle.sources[sourceId];
    const createdLayer = committedStyle.layers.find((layer: any) => layer.id === layerId);

    expect(source.data.type).toBe("FeatureCollection");
    expect(source.data.features).toEqual([
      {
        type: "Feature",
        geometry: {type: "Point", coordinates: [120.5, 30.25]},
        properties: {
          place: "Included",
          longitude: "120.5",
          latitude: "30.25",
          score: "20",
          normalizedValue: 0.2,
        },
      },
    ]);
    expect(sourceId.startsWith("agent-dataset:")).toBe(true);
    expect(createdLayer).toMatchObject({
      id: layerId,
      source: sourceId,
      metadata: {"maputnik:role": "overlay"},
    });
    expect(output).toMatchObject({
      dataset: {
        id: dataset.id,
        name: "values.csv",
        columns: ["place", "longitude", "latitude", "score"],
        inputRowCount: 2,
        validPointFeatureCount: 2,
        outputFeatureCount: 1,
      },
      map: {center: [120, 30], zoom: 6},
      style: {sourceCount: 1, layerCount: 1},
      overlayVerification: {layerIdHasPrefix: true, role: "overlay"},
    });
    expect(output.style.createdLayer.id).toBe(layerId);
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
  it("documents the injected objects and return-only result", () => {
    const tool = runJavascriptToolDefinition();
    expect(tool.description).toContain("map, style, and datasets");
    expect(tool.parameters.properties.code.description).toContain("End with return");
  });
});
