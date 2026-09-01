import {describe, expect, it, vi} from "vitest";

import {
  buildAgentInstructions,
  DATASET_WORKFLOW_EXAMPLE,
  streamResponsesApi,
} from "./agent-client";
import {createAgentExecutionContext, executeAgentJavaScript} from "./agent-executor";
import {createDatasetWorkspace, type Dataset} from "./dataset";
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
  });

  it("executes the shared dataset workflow example through the real executor", async () => {
    const store = new DatasetStore();
    const dataset = await store.addCsv(
      "values.csv",
      "place,lon,lat,value\nIncluded,120.5,30.25,20\nFiltered,121,31,5"
    );
    let liveStyle: any = {version: 8, sources: {}, layers: []};
    let committedStyle: any;
    const map: any = {
      getCenter: () => ({lng: 120, lat: 30}),
      getZoom: () => 6,
      getStyle: () => liveStyle,
      setStyle: (nextStyle: any) => {
        liveStyle = nextStyle;
      },
    };
    const context = createAgentExecutionContext({
      getMap: () => map,
      updateMaputnikStyle: nextStyle => {
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
    expect(createdLayer).toMatchObject({
      id: layerId,
      source: sourceId,
      metadata: {"maputnik:role": "overlay"},
    });
    expect(output.overlayVerification).toEqual({
      layerIdHasPrefix: true,
      role: "overlay",
    });
    expect(output.style.createdLayer.id).toBe(layerId);
  });
});

describe("streamResponsesApi", () => {
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
