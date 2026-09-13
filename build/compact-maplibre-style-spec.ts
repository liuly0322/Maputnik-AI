import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import type {Plugin} from "vite";

const STYLE_SPEC_IMPORT = "@maplibre/maplibre-gl-style-spec/dist/latest.json";
const STYLE_SPEC_VIRTUAL_ID = "\0compact-maplibre-style-spec";
const STYLE_SPEC_LATEST_PATH = createRequire(import.meta.url).resolve(STYLE_SPEC_IMPORT);
const STYLE_SPEC_DOCS_IGNORED_KEYS = new Set([
  "doc",
  "example",
  "sdk-support",
  "expression_name"
]);

function extractStyleSpecDocs(value: unknown): unknown {
  if (Array.isArray(value)) {
    const docs = value.map(extractStyleSpecDocs);
    return docs.some(doc => doc !== undefined) ? docs : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const docs: Record<string, unknown> = {};

  if (typeof record.doc === "string") {
    docs.doc = record.doc;
  }

  for (const [key, child] of Object.entries(record)) {
    if (STYLE_SPEC_DOCS_IGNORED_KEYS.has(key)) {
      continue;
    }

    const childDocs = extractStyleSpecDocs(child);
    if (childDocs !== undefined) {
      docs[key] = childDocs;
    }
  }

  return Object.keys(docs).length > 0 ? docs : undefined;
}

/**
 * Replace the documentation-heavy style spec JSON with the runtime spec plus
 * only the documentation fields used by Maputnik's editors.
 */
export function compactMapLibreStyleSpec(): Plugin {
  return {
    name: "compact-maplibre-style-spec",
    enforce: "pre",
    resolveId(source) {
      return source === STYLE_SPEC_IMPORT ? STYLE_SPEC_VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== STYLE_SPEC_VIRTUAL_ID) {
        return null;
      }

      const styleSpec = JSON.parse(readFileSync(STYLE_SPEC_LATEST_PATH, "utf8"));
      const docs = extractStyleSpecDocs(styleSpec);

      return `
import {latest as runtimeSpec} from "@maplibre/maplibre-gl-style-spec";

const docs = ${JSON.stringify(docs)};

function attachDocs(value, valueDocs) {
  if (Array.isArray(value)) {
    return value.map((item, index) => attachDocs(item, valueDocs?.[index]));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {...value};
  if (!valueDocs || typeof valueDocs !== "object") {
    return result;
  }

  if (typeof valueDocs.doc === "string") {
    result.doc = valueDocs.doc;
  }

  for (const key of Object.keys(value)) {
    if (valueDocs[key] !== undefined) {
      result[key] = attachDocs(value[key], valueDocs[key]);
    }
  }

  return result;
}

export default attachDocs(runtimeSpec, docs);
`;
    }
  };
}
