import "fake-indexeddb/auto";
import {describe, expect, it} from "vitest";

import {datasetToGeoJSON, parseCsv, queryDataset, type Dataset} from "./dataset";
import {DatasetStore} from "./dataset-store";

const dataset: Dataset = {
  id: "test",
  name: "Test",
  columns: ["name", "lon", "lat"],
  rows: [
    {name: "A", lon: "1", lat: "2"},
    {name: "B", lon: "3", lat: "4"},
  ],
  createdAt: 123,
};

describe("parseCsv", () => {
  it("preserves headers and raw rows", () => {
    const parsed = parseCsv("name,lon,lat\nA,1,2\nB,3,4");
    expect(parsed.columns).toEqual(["name", "lon", "lat"]);
    expect(parsed.rows).toEqual([
      {name: "A", lon: "1", lat: "2"},
      {name: "B", lon: "3", lat: "4"},
    ]);
  });
});

describe("datasetToGeoJSON", () => {
  it("uses explicitly provided coordinate columns", () => {
    const geojson = datasetToGeoJSON(dataset, {
      type: "Point",
      coordinates: ["lon", "lat"],
    });
    expect(geojson.features).toEqual([
      {
        type: "Feature",
        geometry: {type: "Point", coordinates: [1, 2]},
        properties: {name: "A", lon: "1", lat: "2"},
      },
      {
        type: "Feature",
        geometry: {type: "Point", coordinates: [3, 4]},
        properties: {name: "B", lon: "3", lat: "4"},
      },
    ]);
  });
});

describe("queryDataset", () => {
  it("filters rows with the provided predicate", () => {
    expect(queryDataset(dataset, row => row.name === "A")).toEqual([dataset.rows[0]]);
  });
});

describe("DatasetStore", () => {
  it("adds, lists, and removes datasets", async () => {
    const store = new DatasetStore();
    await store.init();
    const created = await store.addCsv("points", "name,lon,lat\nA,1,2");

    expect(store.columns(created.id)).toEqual(["name", "lon", "lat"]);
    expect(store.list()).toEqual([
      {
        ...created,
        rowCount: 1,
      },
    ]);

    await store.remove(created.id);
    expect(store.list()).toEqual([]);
  });
});
