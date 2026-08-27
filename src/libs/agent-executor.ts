import type {Map} from "maplibre-gl";
import type {AgentRuntime} from "./agent-runtime";
import type {DatasetWorkspace} from "./dataset";

export type AgentExecutionContext = {
  map: Map | null;
  style: unknown;
  runtime: AgentRuntime;
  datasets: DatasetWorkspace;
  workspace: unknown;
};

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

export async function executeAgentJavaScript(code: string, context: AgentExecutionContext) {
  const logs: string[] = [];
  const log = (...values: unknown[]) => {
    logs.push(values.map(stringifyResult).join(" "));
  };

  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    log(...values);
    originalLog(...values);
  };

  try {
    const execute = new Function(
      "map",
      "style",
      "runtime",
      "datasets",
      "workspace",
      "log",
      `return (async () => {\n${code}\n})();`
    );
    const result = await execute(
      context.map,
      context.style,
      context.runtime,
      context.datasets,
      context.workspace,
      log
    );
    return [...logs, result !== undefined ? `=> ${stringifyResult(result)}` : undefined]
      .filter(value => value !== undefined)
      .join("\n");
  }
  finally {
    console.log = originalLog;
  }
}
