import {afterEach, describe, expect, it, vi} from "vitest";

import {
  executeAgentJavaScript,
  MAX_TOOL_OUTPUT_UTF8_BYTES,
  truncateToolOutput,
} from "./agent-executor";

const utf8Encoder = new TextEncoder();
const datasets: any = {
  get: () => undefined,
  csv: {
    toGeoJSON: () => ({type: "FeatureCollection", features: []}),
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Stands in for the live map: enough of its contract for the executor, plus a
 * way to raise what MapLibre raises for a change it refuses to apply.
 */
function createMapStub() {
  const liveStyle: any = {version: 8, sources: {}, layers: []};
  const listeners = new Map<string, Set<(event: any) => void>>();

  const map: any = {
    liveStyle,
    on(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener);
    },
    addLayer(layer: any) {
      liveStyle.layers.push(layer);
    },
    getStyle: () => liveStyle,
    errorListenerCount: () => listeners.get("error")?.size ?? 0,
    raiseError(message: string) {
      for (const listener of listeners.get("error") ?? []) {
        listener({error: new Error(message)});
      }
    },
  };

  return map;
}

describe("executeAgentJavaScript", () => {
  const context: any = {
    map: null,
    datasets,
    updateMaputnikStyle: vi.fn(),
  };

  it("serializes asynchronous return values", async () => {
    await expect(executeAgentJavaScript("return await Promise.resolve({ids: ['a', 'b'], count: 2});", context)).resolves.toBe(
      '{\n  "ids": [\n    "a",\n    "b"\n  ],\n  "count": 2\n}'
    );
  });

  it("does not include console output in the result", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await executeAgentJavaScript("console.log('diagnostic'); return {ok: true};", context);

    expect(consoleLog).toHaveBeenCalledWith("diagnostic");
    expect(result).toBe('{\n  "ok": true\n}');
    expect(result).not.toContain("diagnostic");
  });

});

describe("live map synchronization", () => {
  it("synchronizes the final map style exactly once", async () => {
    const map = createMapStub();
    const updateMaputnikStyle = vi.fn();
    const context = {
      map,
      updateMaputnikStyle,
      datasets,
    };

    await executeAgentJavaScript(`
      map.addLayer({id: "native", type: "background"});
      return map.getStyle().layers.length;
    `, context);

    expect(updateMaputnikStyle).toHaveBeenCalledTimes(1);
    expect(updateMaputnikStyle).toHaveBeenCalledWith(map.liveStyle);
  });

  it("synchronizes mutations when the script throws", async () => {
    const map = createMapStub();
    const updateMaputnikStyle = vi.fn();
    const context = {map, updateMaputnikStyle, datasets};

    await expect(executeAgentJavaScript(`
      map.addLayer({id: "kept-after-error", type: "background"});
      throw new Error("script failed");
    `, context)).rejects.toThrow("script failed");

    expect(updateMaputnikStyle).toHaveBeenCalledTimes(1);
    expect(updateMaputnikStyle.mock.calls[0][0].layers).toEqual([
      {id: "kept-after-error", type: "background"},
    ]);
  });

});

describe("map errors", () => {
  it("reports what MapLibre raised alongside the result", async () => {
    const map = createMapStub();
    const context = {map, updateMaputnikStyle: vi.fn(), datasets};

    const result = await executeAgentJavaScript(`
      map.raiseError("layers.towers: unknown property");
      return "added 4 layers";
    `, context);

    expect(result).toContain("added 4 layers");
    expect(result).toContain("MapLibre reported 1 error while this ran:");
    expect(result).toContain("- layers.towers: unknown property");
  });

  it("collapses a repeated error and counts the rest", async () => {
    const map = createMapStub();
    const context = {map, updateMaputnikStyle: vi.fn(), datasets};

    const result = await executeAgentJavaScript(`
      for (let i = 0; i < 8; i += 1) map.raiseError("layers.repeated: invalid");
      return "done";
    `, context);

    expect(result).toContain("MapLibre reported 1 error while this ran:");
    expect(result.match(/layers\.repeated/g)).toHaveLength(1);
  });

  it("stops listening once the call is over", async () => {
    const map = createMapStub();
    const context = {map, updateMaputnikStyle: vi.fn(), datasets};

    await executeAgentJavaScript("return 'done';", context);

    expect(map.errorListenerCount()).toBe(0);
  });
});

describe("truncateToolOutput", () => {
  it("returns output at the byte limit unchanged", () => {
    const output = "x".repeat(MAX_TOOL_OUTPUT_UTF8_BYTES);

    expect(truncateToolOutput(output)).toBe(output);
  });

  it("preserves the beginning and end and reports truncation", () => {
    const output = "start\n" + "x".repeat(120_000) + "\nend";

    const truncated = truncateToolOutput(output);

    expect(utf8Encoder.encode(truncated).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_UTF8_BYTES);
    expect(truncated).toMatch(/^start\n/);
    expect(truncated).toMatch(/\nend$/);
    expect(truncated).toContain(
      `[Tool output truncated: original UTF-8 size ${utf8Encoder.encode(output).length} bytes;`
    );
  });

  it("does not split multi-byte UTF-8 characters", () => {
    const output = "头".repeat(20_000) + "中".repeat(20_000) + "尾".repeat(20_000);

    const truncated = truncateToolOutput(output);

    expect(utf8Encoder.encode(truncated).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_UTF8_BYTES);
    expect(truncated.startsWith("头")).toBe(true);
    expect(truncated.endsWith("尾")).toBe(true);
    expect(truncated).not.toContain("�");
    expect(truncated).toContain("[Tool output truncated:");
  });
});
