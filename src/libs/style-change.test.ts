import {describe, expect, it} from "vitest";
import type {StyleSpecification} from "maplibre-gl";

import {compareStyles, formatStyleChangePath} from "./style-change";

function style(overrides: Partial<StyleSpecification> = {}): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [],
    ...overrides,
  } as StyleSpecification;
}

describe("compareStyles", () => {
  it("compares root fields and metadata additions, removals, and nested changes", () => {
    const before = style({
      name: "Before",
      metadata: {kept: "old", removed: true},
      sprite: "before.png",
    });
    const after = style({
      glyphs: "after/{fontstack}/{range}.pbf",
      name: "After",
      metadata: {kept: "new", added: true},
    });

    expect(compareStyles(before, after)).toEqual([
      {kind: "added", path: ["glyphs"], after: "after/{fontstack}/{range}.pbf"},
      {kind: "added", path: ["metadata", "added"], after: true},
      {kind: "changed", path: ["metadata", "kept"], before: "old", after: "new"},
      {kind: "removed", path: ["metadata", "removed"], before: true},
      {kind: "changed", path: ["name"], before: "Before", after: "After"},
      {kind: "removed", path: ["sprite"], before: "before.png"},
    ]);
  });

  it("keeps added and removed sources whole while recursing into retained sources", () => {
    const before = style({sources: {
      old: {type: "vector", url: "old"},
      retained: {type: "vector", url: "before"},
    }});
    const after = style({sources: {
      added: {type: "geojson", data: {type: "FeatureCollection", features: []}},
      retained: {type: "vector", url: "after"},
    }});

    expect(compareStyles(before, after)).toEqual([
      {kind: "added", path: ["sources", "added"], after: after.sources.added},
      {kind: "removed", path: ["sources", "old"], before: before.sources.old},
      {kind: "changed", path: ["sources", "retained", "url"], before: "before", after: "after"},
    ]);
  });

  it("matches layers by ID, treats expression arrays atomically, and reports order separately", () => {
    const beforeFilter = ["==", "kind", "road"] as any;
    const afterFilter = ["in", "kind", "road", "street"] as any;
    const before = style({layers: [
      {id: "water", type: "fill", source: "data", paint: {"fill-color": "blue"}},
      {id: "road", type: "line", source: "data", filter: beforeFilter},
      {id: "old-label", type: "symbol", source: "data"},
    ]});
    const after = style({layers: [
      {id: "road", type: "line", source: "data", filter: afterFilter},
      {id: "water", type: "fill", source: "data", paint: {"fill-color": "navy"}},
      {id: "labels", type: "symbol", source: "data"},
    ]});

    expect(compareStyles(before, after)).toEqual([
      {kind: "added", path: ["layers", "labels"], after: after.layers[2]},
      {kind: "removed", path: ["layers", "old-label"], before: before.layers[2]},
      {kind: "changed", path: ["layers", "road", "filter"], before: beforeFilter, after: afterFilter},
      {kind: "changed", path: ["layers", "water", "paint", "fill-color"], before: "blue", after: "navy"},
      {kind: "changed", path: ["layers", "$order"], before: ["water", "road", "old-label"], after: ["road", "water", "labels"]},
    ]);
  });

  it("returns no changes for equal snapshots and never mutates its inputs", () => {
    const before = style({metadata: {nested: {value: 1}}, layers: [{id: "background", type: "background"}]});
    const after = structuredClone(before);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);

    expect(compareStyles(before, after)).toEqual([]);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });

  it("formats layer IDs and non-identifier object keys as readable paths", () => {
    expect(formatStyleChangePath(["layers", "water", "paint", "fill-color"])).toBe('layers["water"].paint.fill-color');
    expect(formatStyleChangePath(["metadata", "custom key"])).toBe('metadata["custom key"]');
    expect(formatStyleChangePath(["layers", "$order"])).toBe("layers.order");
  });
});
