import isEqual from "lodash.isequal";
import type {StyleSpecification} from "maplibre-gl";

export type StyleChangeKind = "added" | "removed" | "changed";

export type StyleChange = {
  kind: StyleChangeKind;
  path: readonly string[];
  before?: unknown;
  after?: unknown;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareValue(before: unknown, after: unknown, path: readonly string[], changes: StyleChange[]) {
  if (isEqual(before, after)) return;

  if (before === undefined) {
    changes.push({kind: "added", path, after});
    return;
  }
  if (after === undefined) {
    changes.push({kind: "removed", path, before});
    return;
  }
  if (Array.isArray(before) || Array.isArray(after) || !isObject(before) || !isObject(after)) {
    changes.push({kind: "changed", path, before, after});
    return;
  }

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  for (const key of keys) {
    compareValue(before[key], after[key], [...path, key], changes);
  }
}

function layerById(layers: StyleSpecification["layers"]): Map<string, unknown> {
  return new Map((layers ?? []).map(layer => [layer.id, layer]));
}

function compareLayers(
  beforeLayers: StyleSpecification["layers"] | undefined,
  afterLayers: StyleSpecification["layers"] | undefined,
  changes: StyleChange[]
) {
  if (beforeLayers === undefined || afterLayers === undefined) {
    compareValue(beforeLayers, afterLayers, ["layers"], changes);
    return;
  }

  const beforeById = layerById(beforeLayers);
  const afterById = layerById(afterLayers);
  const ids = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort();
  for (const id of ids) {
    compareValue(beforeById.get(id), afterById.get(id), ["layers", id], changes);
  }

  const beforeOrder = beforeLayers.map(layer => layer.id);
  const afterOrder = afterLayers.map(layer => layer.id);
  if (!isEqual(beforeOrder, afterOrder)) {
    changes.push({
      kind: "changed",
      path: ["layers", "$order"],
      before: beforeOrder,
      after: afterOrder,
    });
  }
}

/** Compares complete style snapshots without mutating either input. */
export function compareStyles(before: StyleSpecification, after: StyleSpecification): StyleChange[] {
  const changes: StyleChange[] = [];
  const beforeRoot = before as unknown as JsonObject;
  const afterRoot = after as unknown as JsonObject;
  const keys = Array.from(new Set([...Object.keys(beforeRoot), ...Object.keys(afterRoot)])).sort();

  for (const key of keys) {
    if (key === "layers") {
      compareLayers(before.layers, after.layers, changes);
    }
    else {
      compareValue(beforeRoot[key], afterRoot[key], [key], changes);
    }
  }
  return changes;
}

export function formatStyleChangePath(path: readonly string[]): string {
  return path.reduce((formatted, segment, index) => {
    if (index === 0) return segment;
    if (path[0] === "layers" && index === 1 && segment !== "$order") {
      return `${formatted}[${JSON.stringify(segment)}]`;
    }
    if (segment === "$order") return `${formatted}.order`;
    return /^[A-Za-z_$][\w$-]*$/.test(segment)
      ? `${formatted}.${segment}`
      : `${formatted}[${JSON.stringify(segment)}]`;
  }, "");
}
