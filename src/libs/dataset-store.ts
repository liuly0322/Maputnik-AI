import {parseCsv, parseStoredDataset, type CsvDataset, type Dataset} from "./dataset";

const DATABASE_NAME = "maputnik-datasets";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "datasets";

function generateDatasetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dataset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class DatasetStore {
  private readonly datasets = new Map<string, Dataset>();
  private database: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      return;
    }

    this.database = await this.openDatabase();
    this.datasets.clear();
    await this.loadAndCleanStoredDatasets(this.database);
  }

  getAll(): readonly Dataset[] {
    return Array.from(this.datasets.values());
  }

  get(id: string): Dataset | undefined {
    return this.datasets.get(id);
  }

  async addCsv(name: string, csvText: string): Promise<CsvDataset> {
    const data = parseCsv(csvText);
    const dataset: CsvDataset = {
      id: generateDatasetId(),
      name: name.trim() || "Untitled dataset",
      type: "csv",
      createdAt: Date.now(),
      data,
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

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          database.createObjectStore(OBJECT_STORE_NAME, {keyPath: "id"});
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

  private loadAndCleanStoredDatasets(database: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
      const store = transaction.objectStore(OBJECT_STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;

        const dataset = parseStoredDataset(cursor.value);
        if (dataset) {
          this.datasets.set(dataset.id, dataset);
        }
        else {
          cursor.delete();
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private transact<T>(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
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
