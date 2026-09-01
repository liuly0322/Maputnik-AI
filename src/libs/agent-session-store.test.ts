import "fake-indexeddb/auto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {AgentSessionStore, type AgentSession} from "./agent-session-store";

const DATABASE_NAME = "maputnik-agent";

class LocalStorageMock implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createSession(id: string, createdAt: number): AgentSession {
  return {
    id,
    title: `Session ${id}`,
    inputItems: [{type: "message", role: "user", content: [{type: "input_text", text: `Question ${id}`}]}],
    createdAt,
    updatedAt: createdAt,
    styleCheckpoint: null,
  };
}

function readStoredSession(id: string): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("sessions", "readonly");
      const getRequest = transaction.objectStore("sessions").get(id);
      getRequest.onsuccess = () => resolve(getRequest.result as Record<string, unknown> | undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => database.close();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Agent session database deletion was blocked"));
  });
}

describe("AgentSessionStore", () => {
  const openStores: AgentSessionStore[] = [];

  beforeEach(async () => {
    await deleteDatabase();
    vi.stubGlobal("window", {localStorage: new LocalStorageMock()});
  });

  afterEach(async () => {
    for (const store of openStores) {
      store.close();
    }
    openStores.length = 0;
    await deleteDatabase();
    vi.unstubAllGlobals();
  });

  function createStore() {
    const store = new AgentSessionStore();
    openStores.push(store);
    return store;
  }

  it("persists and deletes sessions as individual records", async () => {
    const firstStore = createStore();
    await firstStore.init();
    await firstStore.put(createSession("older", 1));
    await firstStore.put(createSession("newer", 2));
    firstStore.close();

    const secondStore = createStore();
    expect((await secondStore.init()).map(session => session.id)).toEqual(["newer", "older"]);
    await secondStore.delete("newer");
    secondStore.close();

    const thirdStore = createStore();
    expect((await thirdStore.init()).map(session => session.id)).toEqual(["older"]);
  });

  it("does not persist the in-memory messages display model", async () => {
    const store = createStore();
    await store.init();
    const session = {
      ...createSession("without-messages", 1),
      messages: [{id: "stale", role: "assistant", content: "Do not persist me"}],
    };

    await store.put(session);

    expect(await readStoredSession(session.id)).not.toHaveProperty("messages");
  });

});
