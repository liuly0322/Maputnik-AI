import type {Map, StyleSpecification} from "maplibre-gl";
import type {DatasetWorkspace} from "./dataset";
import {createBatchScheduler, createMapProxy, createStyleProxy} from "./agent-proxies";

export type AgentExecutionContext = {
  map: Map | null;
  style: StyleSpecification;
  datasets: DatasetWorkspace;
};

export type AgentExecutionContextFactoryArgs = {
  getMap(): Map | null;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  datasets: DatasetWorkspace;
};

export const MAX_TOOL_OUTPUT_UTF8_BYTES = 100_000;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function utf8Prefix(bytes: Uint8Array, maxBytes: number) {
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return utf8Decoder.decode(bytes.subarray(0, end));
}

function utf8Suffix(bytes: Uint8Array, maxBytes: number) {
  let start = Math.max(0, bytes.length - maxBytes);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return utf8Decoder.decode(bytes.subarray(start));
}

export function truncateToolOutput(
  output: string,
  maxBytes = MAX_TOOL_OUTPUT_UTF8_BYTES
) {
  const byteLimit = Math.max(0, Math.floor(maxBytes));
  const encoded = utf8Encoder.encode(output);
  if (encoded.length <= byteLimit) {
    return output;
  }

  const notice = [
    "",
    "",
    `[Tool output truncated: original UTF-8 size ${encoded.length} bytes; showing the beginning and end within the ${byteLimit}-byte limit.]`,
    "",
    "",
  ].join("\n");
  const encodedNotice = utf8Encoder.encode(notice);
  if (encodedNotice.length >= byteLimit) {
    return utf8Prefix(encodedNotice, byteLimit);
  }

  const contentBudget = byteLimit - encodedNotice.length;
  const prefixBudget = Math.floor(contentBudget / 2);
  const suffixBudget = contentBudget - prefixBudget;
  return utf8Prefix(encoded, prefixBudget)
    + notice
    + utf8Suffix(encoded, suffixBudget);
}

export function stringifyResult(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  }
  catch {
    return String(value);
  }
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      sanitized[key] = sanitizeJsonValue(child);
    }
    return sanitized;
  }
  return value;
}

function sanitizeStyle(style: StyleSpecification): StyleSpecification {
  return sanitizeJsonValue(style) as StyleSpecification;
}

export function createAgentExecutionContext(
  args: AgentExecutionContextFactoryArgs
): AgentExecutionContext {
  const scheduleMapStyleSync = createBatchScheduler(() => {
    const map = args.getMap();
    const style = map ? map.getStyle() : args.getStyle();
    args.setStyle(sanitizeStyle(style));
  });
  const style = args.getStyle();
  const scheduleStyleCommit = createBatchScheduler(() => {
    args.setStyle(sanitizeStyle(style));
  });
  const map = args.getMap();

  return {
    map: map ? createMapProxy(map, scheduleMapStyleSync) : null,
    style: createStyleProxy(style, scheduleStyleCommit),
    datasets: args.datasets,
  };
}

export async function executeAgentJavaScript(code: string, context: AgentExecutionContext) {
  const execute = new Function(
    "map",
    "style",
    "datasets",
    `return (async () => {\n${code}\n})();`
  );
  const result = await execute(
    context.map,
    context.style,
    context.datasets
  );
  return stringifyResult(result);
}
