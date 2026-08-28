import type {FeatureCollection, Point} from "geojson";
import { datasetToGeoJSON, datasetToSummary, parseCsv, queryDataset, type Dataset, type DatasetSummary, type DatasetWorkspace, type PointGeometryMapping } from "./dataset";

const DATABASE_NAME = "maputnik-datasets";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "datasets";

function generateDatasetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dataset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class DatasetStore implements DatasetWorkspace {
  private readonly datasets = new Map<string, Dataset>();
  private database: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      return;
    }

    this.database = await this.openDatabase();
    const storedDatasets = await this.readAll();
    for (const dataset of storedDatasets) {
      this.datasets.set(dataset.id, dataset);
    }
  }

  list(): DatasetSummary[] {
    return Array.from(this.datasets.values()).map(datasetToSummary);
  }

  get(id: string): Dataset | undefined {
    return this.datasets.get(id);
  }

  async addCsv(name: string, csvText: string): Promise<Dataset> {
    const parsed = parseCsv(csvText);
    const dataset: Dataset = {
      id: generateDatasetId(),
      name: name.trim() || "Untitled dataset",
      columns: parsed.columns,
      rows: parsed.rows,
      createdAt: Date.now(),
    };

    this.datasets.set(dataset.id, dataset);
    await this.persist(dataset);
    return dataset;
  }

  async remove(id: string): Promise<void> {
    if (!this.datasets.delete(id)) {
      return;
    }
    await this.deletePersisted(id);
  }

  columns(id: string): string[] {
    const dataset = this.requireDataset(id);
    return [...dataset.columns];
  }

  query(id: string, predicate: (row: Dataset["rows"][number]) => boolean): Dataset["rows"] {
    const dataset = this.requireDataset(id);
    return queryDataset(dataset, predicate);
  }

  toGeoJSON(id: string, geometry: PointGeometryMapping): FeatureCollection<Point> {
    const dataset = this.requireDataset(id);
    return datasetToGeoJSON(dataset, geometry);
  }

  private requireDataset(id: string): Dataset {
    const dataset = this.datasets.get(id);
    if (!dataset) {
      throw new Error(`Dataset '${id}' does not exist`);
    }
    return dataset;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          db.createObjectStore(OBJECT_STORE_NAME, {keyPath: "id"});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async persist(dataset: Dataset): Promise<void> {
    const database = this.database;
    if (!database) return;
    await this.transact(database, "readwrite", store => store.put(dataset));
  }

  private async deletePersisted(id: string): Promise<void> {
    const database = this.database;
    if (!database) return;
    await this.transact(database, "readwrite", store => store.delete(id));
  }

  private async readAll(): Promise<Dataset[]> {
    const database = this.database;
    if (!database) return [];
    return this.transact(database, "readonly", store => store.getAll()) as Promise<Dataset[]>;
  }

  private transact<T>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE_NAME, mode);
      const store = transaction.objectStore(OBJECT_STORE_NAME);
      const request = operation(store);
      let result: T | undefined;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result as T);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
