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
    style: {version: 8, sources: {}, layers: []},
    datasets,
  };

  it("serializes synchronous and asynchronous returns", async () => {
    await expect(executeAgentJavaScript("return 42;", context)).resolves.toBe("42");
    await expect(executeAgentJavaScript("return await Promise.resolve('done');", context)).resolves.toBe("done");
  });

  it("serializes returned objects and arrays", async () => {
    await expect(executeAgentJavaScript("return {ids: ['a', 'b'], count: 2};", context)).resolves.toBe(
      '{\n  "ids": [\n    "a",\n    "b"\n  ],\n  "count": 2\n}'
    );
  });

  it("represents an undefined return explicitly", async () => {
    await expect(executeAgentJavaScript("return undefined;", context)).resolves.toBe("undefined");
  });

  it("does not include console output in the result", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await executeAgentJavaScript("console.log('diagnostic'); return {ok: true};", context);

    expect(consoleLog).toHaveBeenCalledWith("diagnostic");
    expect(result).toBe('{\n  "ok": true\n}');
    expect(result).not.toContain("diagnostic");
  });

  it("injects only the DatasetWorkspace facade", async () => {
    await expect(executeAgentJavaScript(
      "return {workspace: Object.keys(datasets), csv: Object.keys(datasets.csv)};",
      context
    )).resolves.toBe(
      '{\n  "workspace": [\n    "get",\n    "csv"\n  ],\n  "csv": [\n    "toGeoJSON"\n  ]\n}'
    );
  });
});

describe("createAgentExecutionContext", () => {
  it("commits source and layer changes made through style", async () => {
    const style: any = {version: 8, sources: {}, layers: []};
    let committedStyle: any;
    const context = createAgentExecutionContext({
      getMap: () => null,
      getStyle: () => style,
      setStyle: nextStyle => {
        committedStyle = nextStyle;
      },
      datasets,
    });

    await executeAgentJavaScript(`
      style.sources.points = {type: "geojson", data: {type: "FeatureCollection", features: []}};
      style.layers.push({id: "points", type: "circle", source: "points"});
      return {sourceCount: Object.keys(style.sources).length, layerCount: style.layers.length};
    `, context);
    await Promise.resolve();

    expect(committedStyle.sources.points.type).toBe("geojson");
    expect(committedStyle.layers).toEqual([{id: "points", type: "circle", source: "points"}]);
  });

  it("synchronizes native map mutations back to the editable style", async () => {
    const liveStyle: any = {version: 8, sources: {}, layers: []};
    let committedStyle: any;
    const map: any = {
      addLayer(layer: any) {
        liveStyle.layers.push(layer);
      },
      getStyle() {
        return liveStyle;
      },
    };
    const context = createAgentExecutionContext({
      getMap: () => map,
      getStyle: () => ({version: 8, sources: {}, layers: []}),
      setStyle: nextStyle => {
        committedStyle = nextStyle;
      },
      datasets,
    });

    await executeAgentJavaScript('map.addLayer({id: "native", type: "background"}); return map.getStyle().layers.length;', context);
    await Promise.resolve();

    expect(committedStyle.layers).toEqual([{id: "native", type: "background"}]);
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
