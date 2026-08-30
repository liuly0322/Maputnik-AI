import {describe, expect, it, vi} from "vitest";

import {
  buildAgentInstructions,
  createUserInputItem,
  DATASET_WORKFLOW_EXAMPLE,
  runJavascriptToolDefinition,
  streamResponsesApi,
} from "./agent-client";
import {createAgentExecutionContext, executeAgentJavaScript} from "./agent-executor";
import {createDatasetWorkspace, DATASET_TYPE_REFERENCE, type Dataset} from "./dataset";
import {DatasetStore} from "./dataset-store";

const datasets: Dataset[] = [
  {
    id: "places-2026",
    name: "places.csv",
    type: "csv",
    createdAt: 100,
    data: {
      columns: ["name", "longitude", "latitude", "score"],
      rows: [],
    },
  },
  {
    id: "stations-2026",
    name: "stations.csv",
    type: "csv",
    createdAt: 200,
    data: {
      columns: ["station", "lon", "lat"],
      rows: [],
    },
  },
];

describe("buildAgentInstructions", () => {
  it("describes the actual execution and discriminated dataset contracts", () => {
    const instructions = buildAgentInstructions(datasets);

    expect(instructions).toContain("provides three objects:");
    expect(instructions).toContain("- map: the live MapLibre Map instance.");
    expect(instructions).toContain("- style: a writable proxy");
    expect(instructions).toContain("- datasets: the browser-local dataset workspace.");
    expect(instructions).toContain(DATASET_TYPE_REFERENCE);
    expect(instructions).toContain("readonly type: TType");
    expect(instructions).toContain('type CsvDataset = BaseDataset<\n  "csv"');
    expect(instructions).toContain("readonly rows: readonly (readonly string[])[]");
    expect(instructions).toContain("datasets.get(...)");
    expect(instructions).toContain("datasets.csv.toGeoJSON(...)");
    expect(instructions).toContain("End every execution with return.");
    expect(instructions).toContain("Set layer.id to a unique descriptive ID beginning with agent-dataset:.");
    expect(instructions).toContain("Set layer.metadata[\"maputnik:role\"] to \"overlay\".");
    expect(instructions).toContain(DATASET_WORKFLOW_EXAMPLE);
  });

  it("includes exact public metadata for every loaded dataset", () => {
    const instructions = buildAgentInstructions(datasets);
    const catalog = JSON.parse(instructions.split("# Dataset catalog\n\n")[1]);

    expect(catalog).toEqual([
      {
        id: "places-2026",
        name: "places.csv",
        type: "csv",
        createdAt: 100,
        columns: ["name", "longitude", "latitude", "score"],
        rowCount: 0,
      },
      {
        id: "stations-2026",
        name: "stations.csv",
        type: "csv",
        createdAt: 200,
        columns: ["station", "lon", "lat"],
        rowCount: 0,
      },
    ]);
    const environmentObjects = Array.from(
      instructions.matchAll(/^- ([a-z]+):/gm),
      match => match[1]
    );
    expect(environmentObjects).toEqual(["map", "style", "datasets"]);
    expect(instructions).not.toContain("selectedLayer");
    expect(instructions).not.toContain("selection count");
    expect(instructions).not.toContain("Current live");
  });

  it("executes the shared dataset workflow example through the real executor", async () => {
    const store = new DatasetStore();
    const dataset = await store.addCsv(
      "values.csv",
      "place,lon,lat,value\nIncluded,120.5,30.25,20\nFiltered,121,31,5"
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
      datasets: createDatasetWorkspace(store),
    });
    const code = DATASET_WORKFLOW_EXAMPLE.replace("<exact ID from the dataset catalog>", dataset.id);

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
          lon: "120.5",
          lat: "30.25",
          value: "20",
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
        type: "csv",
        columns: ["place", "lon", "lat", "value"],
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

describe("streamResponsesApi", () => {
  it("includes prior assistant replies in the request input", async () => {
    const input = [{
      type: "message",
      role: "user",
      content: [{type: "input_text", text: "First question"}],
    }, {
      type: "message",
      id: "msg_1",
      role: "assistant",
      content: [{type: "output_text", text: "First reply"}],
    }, {
      type: "message",
      role: "user",
      content: [{type: "input_text", text: "Follow-up question"}],
    }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", {
      headers: {"Content-Type": "text/event-stream"},
    }));

    try {
      const stream = streamResponsesApi(
        {apiKey: "key", endpoint: "https://example.test/responses", model: "model"},
        "instructions",
        input
      );

      await expect(stream.next()).resolves.toMatchObject({done: true});
      const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(request.input).toEqual(input);
    }
    finally {
      fetchMock.mockRestore();
    }
  });

  it("passes an abort signal through to the streaming request", async () => {
    const abortController = new AbortController();
    const encoder = new TextEncoder();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: response.output_text.delta",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}",
            "",
            "",
          ].join("\n")));
          signal?.addEventListener("abort", () => controller.error(signal.reason), {once: true});
        },
      });
      return Promise.resolve(new Response(body, {
        headers: {"Content-Type": "text/event-stream"},
      }));
    });

    try {
      const stream = streamResponsesApi(
        {apiKey: "key", endpoint: "https://example.test/responses", model: "model"},
        "instructions",
        [],
        abortController.signal
      );

      await expect(stream.next()).resolves.toMatchObject({
        value: {type: "response.output_text.delta", data: {delta: "partial"}},
      });
      const nextEvent = stream.next();
      abortController.abort();

      await expect(nextEvent).rejects.toMatchObject({name: "AbortError"});
      expect(fetchMock.mock.calls[0][1]?.signal).toBe(abortController.signal);
    }
    finally {
      fetchMock.mockRestore();
    }
  });
});
