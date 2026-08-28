import { describe, it, expect, beforeEach, vi } from "vitest";
import { StyleStore } from "./stylestore";

class LocalStorageMock {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  key(i: number) {
    return Object.keys(this.store)[i] ?? null;
  }
  getItem(k: string) {
    return k in this.store ? this.store[k] : null;
  }
  setItem(k: string, v: string) {
    this.store[k] = v;
  }
  removeItem(k: string) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}
vi.stubGlobal("window", { localStorage: new LocalStorageMock() });
// loadDefaultStyle fetches the default style over the network; serve it locally.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    json: async () => ({ version: 8, id: "default", sources: {}, layers: [] }),
  }))
);

const style = (id: string) => ({ version: 8, id, sources: {}, layers: [] }) as any;

describe("StyleStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default style when nothing is stored", async () => {
    const store = new StyleStore();
    const latest = await store.getLatestStyle();
    expect(latest.id).toBe("default");
  });

  it("saves a style and reads it back as the latest", async () => {
    const store = new StyleStore();
    store.save(style("abc"));
    // A fresh store discovers the persisted style ids.
    const reopened = new StyleStore();
    const latest = await reopened.getLatestStyle();
    expect(latest.id).toBe("abc");
  });

  it("keeps only the current style after saving a style with a new id", () => {
    const store = new StyleStore();
    store.save(style("abc"));
    window.localStorage.setItem("maputnik:agent_settings", "settings");

    store.save(style("def"));

    expect(window.localStorage.getItem("maputnik:style:abc")).toBeNull();
    expect(window.localStorage.getItem("maputnik:style:def")).not.toBeNull();
    expect(window.localStorage.getItem("maputnik:agent_settings")).toBe("settings");
  });

  it("removes unreachable stored styles on startup", () => {
    window.localStorage.setItem("maputnik:style:old", JSON.stringify(style("old")));
    window.localStorage.setItem("maputnik:style:current", JSON.stringify(style("current")));
    window.localStorage.setItem("maputnik:latest_style", "current");

    const store = new StyleStore();

    expect(store.mapStyles).toEqual(["current"]);
    expect(window.localStorage.getItem("maputnik:style:old")).toBeNull();
    expect(window.localStorage.getItem("maputnik:style:current")).not.toBeNull();
  });

  it("purge removes style history but preserves other local settings", async () => {
    const store = new StyleStore();
    store.save(style("abc"));
    window.localStorage.setItem("unrelated", "keep");
    window.localStorage.setItem("maputnik:agent_settings", "settings");
    store.purge();
    expect(window.localStorage.getItem("maputnik:style:abc")).toBeNull();
    expect(window.localStorage.getItem("maputnik:latest_style")).toBeNull();
    expect(window.localStorage.getItem("maputnik:agent_settings")).toBe("settings");
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
