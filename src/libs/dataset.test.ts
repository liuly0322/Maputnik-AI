import "fake-indexeddb/auto";
import {beforeEach, describe, expect, it} from "vitest";

import {
  createDatasetWorkspace,
  csvDatasetToGeoJSON,
  parseCsv,
  parseStoredDataset,
  type CsvDataset,
  type Dataset,
} from "./dataset";
import {DatasetStore} from "./dataset-store";

const DATABASE_NAME = "maputnik-datasets";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "datasets";

const dataset: CsvDataset = {
  id: "test",
  name: "Test",
  type: "csv",
  createdAt: 123,
  data: {
    columns: ["name", "latitude", "longitude", "value"],
    rows: [
      ["A", "2", "1", "10"],
      ["B", "4", "3", "20"],
    ],
  },
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        request.result.createObjectStore(OBJECT_STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function replacePersistedDatasets(values: readonly Record<string, unknown>[]) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    store.clear();
    values.forEach(value => store.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

async function readPersistedDatasets(): Promise<unknown[]> {
  const database = await openDatabase();
  const values = await new Promise<unknown[]>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, "readonly");
    const request = transaction.objectStore(OBJECT_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return values;
}

describe("parseCsv", () => {
  it("trims header cells and preserves data cells as string arrays", () => {
    const parsed = parseCsv(
      " name , value , enabled , date , empty \n A ,001,true,2026-01-02,\nB,2,false,2026-02-03,text"
    );

    expect(parsed).toEqual({
      columns: ["name", "value", "enabled", "date", "empty"],
      rows: [
        [" A ", "001", "true", "2026-01-02", ""],
        ["B", "2", "false", "2026-02-03", "text"],
      ],
    });
    expect(parsed.rows.flat().every(value => typeof value === "string")).toBe(true);
  });

  it("rejects a file without a valid header", () => {
    expect(() => parseCsv(",,\nA,1,2")).toThrow("does not contain a valid header");
  });

  it("rejects structural Papa Parse errors", () => {
    expect(() => parseCsv('name,value\n"unterminated,1')).toThrow("Could not parse CSV");
  });
});

describe("parseStoredDataset", () => {
  it("accepts a valid CsvDataset", () => {
    expect(parseStoredDataset(dataset)).toBe(dataset);
  });

  it.each([
    ["non-string id", {id: 1, name: "Invalid", type: "csv", createdAt: 1, data: {columns: [], rows: []}}],
    ["non-string name", {id: "name", name: null, type: "csv", createdAt: 1, data: {columns: [], rows: []}}],
    ["non-number createdAt", {id: "created", name: "Invalid", type: "csv", createdAt: "1", data: {columns: [], rows: []}}],
    ["missing type", {id: "flat", name: "Flat", columns: ["a"], rows: [["b"]], createdAt: 1}],
    ["missing data", {id: "missing-data", name: "Missing", type: "csv", createdAt: 1}],
    ["non-string column", {id: "columns", name: "Columns", type: "csv", createdAt: 1, data: {columns: ["a", 2], rows: []}}],
    ["non-matrix rows", {id: "rows", name: "Rows", type: "csv", createdAt: 1, data: {columns: ["a"], rows: [{a: "b"}]}}],
    ["non-string row cell", {id: "cell", name: "Cell", type: "csv", createdAt: 1, data: {columns: ["a"], rows: [[2]]}}],
    ["unknown type", {id: "unknown", name: "Unknown", type: "geojson", createdAt: 1, data: {}}],
  ])("rejects %s", (_label, value) => {
    expect(parseStoredDataset(value)).toBeUndefined();
  });
});

describe("csvDatasetToGeoJSON", () => {
  it("uses column indexes, rebuilds properties, and does not modify the dataset", () => {
    const original = structuredClone(dataset);
    const geojson = csvDatasetToGeoJSON(dataset, {
      type: "Point",
      coordinates: ["longitude", "latitude"],
    });

    expect(geojson.features).toEqual([
      {
        type: "Feature",
        geometry: {type: "Point", coordinates: [1, 2]},
        properties: {name: "A", latitude: "2", longitude: "1", value: "10"},
      },
      {
        type: "Feature",
        geometry: {type: "Point", coordinates: [3, 4]},
        properties: {name: "B", latitude: "4", longitude: "3", value: "20"},
      },
    ]);
    expect(dataset).toEqual(original);
  });

  it("skips blank, missing, non-numeric, and non-finite coordinates", () => {
    const invalidCoordinates: CsvDataset = {
      ...dataset,
      data: {
        columns: ["lon", "lat"],
        rows: [
          ["1", "2"],
          ["", "2"],
          [" ", "2"],
          ["1"],
          ["not-a-number", "2"],
          ["Infinity", "2"],
          ["1", "NaN"],
        ],
      },
    };

    expect(csvDatasetToGeoJSON(invalidCoordinates, {
      type: "Point",
      coordinates: ["lon", "lat"],
    }).features).toHaveLength(1);
  });

  it("reports missing coordinate columns explicitly", () => {
    expect(() => csvDatasetToGeoJSON(dataset, {
      type: "Point",
      coordinates: ["lon", "latitude"],
    })).toThrow("CSV coordinate column 'lon' does not exist");
  });
});

describe("DatasetWorkspace", () => {
  it("exposes only get and the CSV Point adapter", () => {
    const workspace = createDatasetWorkspace({get: id => id === dataset.id ? dataset : undefined});

    expect(Object.keys(workspace)).toEqual(["get", "csv"]);
    expect(Object.keys(workspace.csv)).toEqual(["toGeoJSON"]);
    expect(workspace.get(dataset.id)).toBe(dataset);
    expect(workspace.csv.toGeoJSON(dataset, {
      type: "Point",
      coordinates: ["longitude", "latitude"],
    }).features).toHaveLength(2);
  });
});

describe("DatasetStore", () => {
  beforeEach(async () => {
    await replacePersistedDatasets([]);
  });

  it("adds, returns, persists, and removes CsvDatasets", async () => {
    const store = new DatasetStore();
    await store.init();
    const created = await store.addCsv("points.csv", "name,lon,lat\nA,1,2");

    expect(created).toMatchObject({name: "points.csv", type: "csv"});
    expect(created.data).toEqual({
      columns: ["name", "lon", "lat"],
      rows: [["A", "1", "2"]],
    });
    expect(store.get(created.id)).toBe(created);
    expect(store.getAll()).toEqual([created]);
    expect(await readPersistedDatasets()).toEqual([created]);

    await store.remove(created.id);
    expect(store.getAll()).toEqual([]);
    expect(await readPersistedDatasets()).toEqual([]);
  });

  it("does not create a dataset when CSV parsing fails", async () => {
    const store = new DatasetStore();

    await expect(store.addCsv("broken.csv", 'name,value\n"unterminated,1')).rejects.toThrow("Could not parse CSV");
    expect(store.getAll()).toEqual([]);
  });

  it("loads valid records while deleting invalid and legacy records", async () => {
    const valid: Dataset = {
      id: "valid",
      name: "valid.csv",
      type: "csv",
      createdAt: 10,
      data: {columns: ["name"], rows: [["A"]]},
    };
    const invalid = {
      id: "invalid",
      name: "invalid.csv",
      type: "csv",
      createdAt: 20,
      data: {columns: ["name", 2], rows: []},
    };
    const legacy = {
      id: "legacy",
      name: "legacy.csv",
      columns: ["name"],
      rows: [{name: "A"}],
      createdAt: 30,
    };
    await replacePersistedDatasets([invalid, valid, legacy]);

    const store = new DatasetStore();
    await store.init();

    expect(store.getAll()).toEqual([valid]);
    expect(await readPersistedDatasets()).toEqual([valid]);
  });

  it("deletes an unknown dataset type without blocking another valid record", async () => {
    const valid = structuredClone(dataset);
    const unknown = {
      id: "unknown",
      name: "unknown.data",
      type: "future-type",
      createdAt: 200,
      data: {},
    };
    await replacePersistedDatasets([valid, unknown]);

    const store = new DatasetStore();
    await store.init();

    expect(store.getAll()).toEqual([valid]);
    expect(await readPersistedDatasets()).toEqual([valid]);
  });
});
