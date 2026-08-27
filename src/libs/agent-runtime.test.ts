import {describe, expect, it, vi} from "vitest";
import type {StyleSpecification} from "maplibre-gl";
import type {Feature} from "geojson";

import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
  createAgentRuntimeFactory,
  createAgentRuntimeSnapshot,
} from "./agent-runtime";

const style = {
  version: 8,
  name: "Test",
  center: [1, 2],
  zoom: 3,
  sources: {
    example: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {},
    },
  ],
} as StyleSpecification;

describe("createAgentRuntimeSnapshot", () => {
  it("falls back to the style viewport when no map is attached", () => {
    const snapshot = createAgentRuntimeSnapshot({
      map: null,
      style,
      selectedLayerIndex: 0,
      selection: [],
      datasets: [],
    });

    expect(snapshot.viewport.center).toEqual([1, 2]);
    expect(snapshot.viewport.zoom).toBe(3);
    expect(snapshot.selectedLayer?.id).toBe("background");
    expect(Object.keys(snapshot.sources)).toEqual(["example"]);
  });

  it("returns detached data without mutating the live style or selection", () => {
    const selection: Feature[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
        properties: {},
      },
    ];
    const snapshot = createAgentRuntimeSnapshot({
      map: null,
      style,
      selectedLayerIndex: 0,
      selection,
      datasets: [],
    });

    snapshot.style.name = "Changed";
    snapshot.selection[0].properties = {changed: true};

    expect(style.name).toBe("Test");
    expect(selection[0].properties).toEqual({});
  });
});

describe("createAgentRuntimeFactory", () => {
  it("normalizes dataset layer ids into the overlay prefix", () => {
    const setStyle = vi.fn();
    const runtime = createAgentRuntimeFactory({
      getMap: () => null,
      getStyle: () => ({version: 8, sources: {}, layers: []}) as StyleSpecification,
      setStyle,
      getSelectedLayerIndex: () => 0,
      getSelection: () => [],
      setSelection: () => {},
      getDatasets: () => [],
      datasets: {
        toGeoJSON: () => ({type: "FeatureCollection", features: []}),
      } as any,
    });

    const id = runtime.addDatasetLayer("ds1", {
      geometry: {type: "Point", coordinates: ["lon", "lat"]},
      type: "heatmap",
      id: "points",
    });

    expect(id).toBe(`${AGENT_OVERLAY_LAYER_PREFIX}points`);
    expect(setStyle).toHaveBeenCalledOnce();
    const style = setStyle.mock.calls[0][0] as StyleSpecification;
    expect(style.layers?.[0].id).toBe(`${AGENT_OVERLAY_LAYER_PREFIX}points`);
    expect(style.layers?.[0].type).toBe("heatmap");
    expect(style.layers?.[0].metadata).toEqual({[AGENT_OVERLAY_METADATA_KEY]: AGENT_OVERLAY_ROLE});
    expect(style.sources?.[`${AGENT_OVERLAY_LAYER_PREFIX}ds1`]).toBeTruthy();
  });
});
