import type {AgentInputItem} from "./agent-client";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: string[];
};

export type AgentSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  inputItems: AgentInputItem[];
  createdAt: number;
  updatedAt: number;
};

const DATABASE_NAME = "maputnik-agent";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "sessions";
export const LEGACY_AGENT_SESSIONS_KEY = "maputnik:agent_sessions";

function isAgentSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AgentSession>;
  return typeof session.id === "string"
    && typeof session.title === "string"
    && Array.isArray(session.messages)
    && Array.isArray(session.inputItems)
    && typeof session.createdAt === "number"
    && typeof session.updatedAt === "number";
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  }
  catch {
    return null;
  }
}

function readLegacySessions(storage: Storage | null): AgentSession[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_AGENT_SESSIONS_KEY);
    if (!raw) return null;
    const sessions = JSON.parse(raw) as unknown;
    if (!Array.isArray(sessions) || !sessions.every(isAgentSession)) return null;
    return sessions;
  }
  catch {
    return null;
  }
}

export class AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private database: IDBDatabase | null = null;
  private useLocalStorageFallback = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async init(): Promise<AgentSession[]> {
    const storage = getLocalStorage();
    const legacySessions = readLegacySessions(storage);

    if (typeof indexedDB === "undefined") {
      this.useLocalStorageFallback = true;
      this.replaceSessions(legacySessions ?? []);
      return this.list();
    }

    try {
      this.database = await this.openDatabase();
      const storedSessions = (await this.readAll()).filter(isAgentSession);
      const sessionsById = new Map(storedSessions.map(session => [session.id, session]));

      if (legacySessions) {
        const sessionsToMigrate = legacySessions.filter(session => {
          const stored = sessionsById.get(session.id);
          return !stored || session.updatedAt > stored.updatedAt;
        });
        if (sessionsToMigrate.length > 0) {
          await this.putMany(sessionsToMigrate);
          for (const session of sessionsToMigrate) {
            sessionsById.set(session.id, session);
          }
        }
        try {
          storage?.removeItem(LEGACY_AGENT_SESSIONS_KEY);
        }
        catch {
          // Migration succeeded; a stale legacy copy can be retried safely.
        }
      }

      this.replaceSessions(Array.from(sessionsById.values()));
      return this.list();
    }
    catch {
      this.database?.close();
      this.database = null;
      this.useLocalStorageFallback = true;
      this.replaceSessions(legacySessions ?? []);
      return this.list();
    }
  }

  list(): AgentSession[] {
    return Array.from(this.sessions.values()).sort((left, right) => {
      return right.createdAt - left.createdAt;
    });
  }

  put(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, session);
    return this.enqueueWrite(async () => {
      if (this.useLocalStorageFallback) {
        this.persistFallback();
        return;
      }
      const database = this.database;
      if (!database) return;
      await this.transact(database, "readwrite", store => store.put(session));
    });
  }

  delete(id: string): Promise<void> {
    this.sessions.delete(id);
    return this.enqueueWrite(async () => {
      if (this.useLocalStorageFallback) {
        this.persistFallback();
        return;
      }
      const database = this.database;
      if (!database) return;
      await this.transact(database, "readwrite", store => store.delete(id));
    });
  }

  close(): void {
    const database = this.database;
    void this.writeQueue.catch(() => undefined).then(() => {
      database?.close();
      if (this.database === database) {
        this.database = null;
      }
    });
  }

  private replaceSessions(sessions: AgentSession[]): void {
    this.sessions.clear();
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }

  private persistFallback(): void {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(LEGACY_AGENT_SESSIONS_KEY, JSON.stringify(this.list()));
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queued = this.writeQueue.catch(() => undefined).then(operation);
    this.writeQueue = queued;
    return queued;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          const store = database.createObjectStore(OBJECT_STORE_NAME, {keyPath: "id"});
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async putMany(sessions: AgentSession[]): Promise<void> {
    const database = this.database;
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
      const store = transaction.objectStore(OBJECT_STORE_NAME);
      for (const session of sessions) {
        store.put(session);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private async readAll(): Promise<AgentSession[]> {
    const database = this.database;
    if (!database) return [];
    return this.transact(database, "readonly", store => store.getAll()) as Promise<AgentSession[]>;
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
