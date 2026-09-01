import {afterEach, describe, expect, it, vi} from "vitest";

import {
  createAgentExecutionContext,
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

describe("createAgentExecutionContext", () => {
  it("synchronizes the final map style exactly once", async () => {
    const liveStyle: any = {
      version: 8,
      sources: {},
      layers: [],
    };
    const map: any = {
      addLayer(layer: any) {
        liveStyle.layers.push(layer);
      },
      getStyle() {
        return liveStyle;
      },
    };
    const updateMaputnikStyle = vi.fn();
    const context = createAgentExecutionContext({
      getMap: () => map,
      updateMaputnikStyle,
      datasets,
    });

    await executeAgentJavaScript(`
      map.addLayer({id: "native", type: "background"});
      return map.getStyle().layers.length;
    `, context);

    expect(updateMaputnikStyle).toHaveBeenCalledTimes(1);
    expect(updateMaputnikStyle).toHaveBeenCalledWith(liveStyle);
  });

  it("synchronizes mutations when the script throws", async () => {
    const liveStyle: any = {version: 8, sources: {}, layers: []};
    const map: any = {
      addLayer(layer: any) {
        liveStyle.layers.push(layer);
      },
      getStyle: () => liveStyle,
    };
    const updateMaputnikStyle = vi.fn();
    const context = createAgentExecutionContext({getMap: () => map, updateMaputnikStyle, datasets});

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
