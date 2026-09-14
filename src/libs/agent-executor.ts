import type {Map, StyleSpecification} from "maplibre-gl";
import type {DatasetWorkspace} from "./dataset";

export type AgentExecutionContext = {
  map: Map | null;
  datasets: DatasetWorkspace;
  updateMaputnikStyle(style: StyleSpecification): void;
};

export const MAX_TOOL_OUTPUT_UTF8_BYTES = 100_000;

/** More than this and the model is reading a flood rather than a message. */
const MAX_REPORTED_MAP_ERRORS = 5;

/**
 * Collects the errors MapLibre raises while the code runs. A style or layer
 * that fails validation does not throw: the call returns, the change is simply
 * not applied, and the only trace is an `error` event — a channel the tool
 * result does not otherwise carry. Returns a function that stops collecting
 * and hands back what it saw.
 */
function collectMapErrors(map: Map) {
  const messages: string[] = [];
  const onError = (event: {error?: unknown}) => {
    const message = event.error instanceof Error ? event.error.message : String(event.error ?? "");
    if (message && !messages.includes(message)) {
      messages.push(message);
    }
  };

  map.on("error", onError);
  return {
    messages,
    stop: () => map.off("error", onError),
  };
}

function describeMapErrors(messages: readonly string[]) {
  if (messages.length === 0) {
    return "";
  }

  const reported = messages.slice(0, MAX_REPORTED_MAP_ERRORS);
  const lines = reported.map(message => `- ${message}`);
  if (messages.length > reported.length) {
    lines.push(`- ...and ${messages.length - reported.length} more`);
  }

  const noun = messages.length === 1 ? "error" : "errors";
  return `\n\nMapLibre reported ${messages.length} ${noun} while this ran:\n${lines.join("\n")}`;
}

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

export async function executeAgentJavaScript(code: string, context: AgentExecutionContext) {
  const errors = context.map ? collectMapErrors(context.map) : null;
  const execute = new Function(
    "map",
    "datasets",
    `return (async () => {\n${code}\n})();`
  );

  let output: string;
  try {
    const result = await execute(
      context.map,
      context.datasets
    );
    output = stringifyResult(result);
  }
  finally {
    // Stopped before the style is synced, so what is reported belongs to the
    // model's code rather than to the sync that follows it.
    errors?.stop();
    if (context.map) {
      context.updateMaputnikStyle(sanitizeStyle(context.map.getStyle()));
    }
  }

  return output + describeMapErrors(errors?.messages ?? []);
}
