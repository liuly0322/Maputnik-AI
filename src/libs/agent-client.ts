import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
  type AgentRuntimeSnapshot,
} from "./agent-runtime";

export type AgentSettings = {
  apiKey: string;
  endpoint: string;
  model: string;
};

export type AgentInputItem = Record<string, any>;

export type AgentApiResponse = {
  output?: Array<Record<string, any>>;
  error?: {
    message?: string;
  };
};

export type AgentStreamEvent = {
  type: string;
  data: any;
};

export function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}

export function defaultAgentSettings(): AgentSettings {
  return {
    apiKey: "",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-4.1-mini",
  };
}

export function buildAgentInstructions(snapshot: AgentRuntimeSnapshot, selectedDatasetIds: string[] = []): string {
  const layers = (snapshot.layers ?? []).map(layer => `${layer.id} (${layer.type})`).join(", ");
  const datasets = (snapshot.datasets ?? []).filter(dataset => {
    return selectedDatasetIds.length === 0 || selectedDatasetIds.includes(dataset.id);
  });
  const datasetLines = datasets.map(dataset => {
    return `${dataset.id}: ${dataset.name}, columns=[${dataset.columns.join(", ")}], rows=${dataset.rowCount}`;
  }).join("; ");

  return [
    "You are the built-in agent inside Maputnik.",
    "You can read and modify the live map by calling run_javascript.",
    "run_javascript is your JavaScript evaluation environment on the live runtime; treat it like eval for Maputnik state.",
    "Whenever a task requires counting, arithmetic, statistics, comparison, or verifying a value, run JavaScript through run_javascript instead of estimating from memory.",
    "Layer classification rules:",
    "- An overlay layer visualizes, colors, filters, or otherwise encodes any user-provided dataset, even when it is applied to an existing vector source.",
    "- A base-map layer only styles background, tiles, roads, labels, or other non-data cartography and does not depend on the user-provided dataset.",
    `- For any data-related layer, prefer runtime.addDatasetLayer(...), which automatically adds the ${AGENT_OVERLAY_LAYER_PREFIX} prefix and metadata ${AGENT_OVERLAY_METADATA_KEY}=${AGENT_OVERLAY_ROLE}.`,
    `- If you must use map.addLayer(...) or style.layers.push(...) for data, give the new layer an ID starting with ${AGENT_OVERLAY_LAYER_PREFIX} and set layer.metadata["${AGENT_OVERLAY_METADATA_KEY}"]="${AGENT_OVERLAY_ROLE}".`,
    `- Before finishing a task that added data-related layers, run run_javascript to inspect style.layers and verify every such layer has the ${AGENT_OVERLAY_LAYER_PREFIX} prefix or ${AGENT_OVERLAY_METADATA_KEY}=${AGENT_OVERLAY_ROLE}; fix any missing one.`,
    "Inside run_javascript, the variables map, style, runtime, datasets, workspace, and log are available.",
    "style is a plain style object, so use style.layers and style.sources. map is the native MapLibre Map instance, so use map.getStyle(), map.addLayer(), map.removeLayer(), etc.",
    "Use native MapLibre methods or mutate the style object, then return useful context or logs.",
    "Make small, reversible changes and inspect state before changing it.",
    "",
    "Dataset access examples inside run_javascript:",
    "const ds = runtime.datasets.list()[0];",
    "const full = runtime.datasets.get(ds.id); // full.rows, full.columns",
    "const columns = runtime.datasets.columns(ds.id);",
    "const rows = runtime.datasets.query(ds.id, row => Number(row.population) > 1000);",
    "const geojson = runtime.datasets.toGeoJSON(ds.id, { type: \"Point\", coordinates: [\"lon\", \"lat\"] });",
    "runtime.addDatasetLayer(ds.id, { geometry: { type: \"Point\", coordinates: [\"lon\", \"lat\"] }, type: \"circle\", paint: { \"circle-radius\": [\"to-number\", [\"get\", \"value\"]] } });",
    "CSV values are strings by default; use Number(value) or the MapLibre expression [\"to-number\", [\"get\", \"column\"]] when a number is required.",
    "",
    "Current live runtime summary:",
    `viewport center=${snapshot.viewport.center.join(",")} zoom=${snapshot.viewport.zoom}`,
    `layers=[${layers}]`,
    `selectedLayer=${snapshot.selectedLayer?.id ?? "none"}`,
    `selection count=${snapshot.selection?.length ?? 0}`,
    `datasets=[${datasetLines}]`,
  ].join("\n");
}

export function createUserInputItem(text: string, images: string[] = []): AgentInputItem {
  const content: Array<Record<string, any>> = [
    {
      type: "input_text",
      text,
    },
  ];

  for (const image of images) {
    content.push({
      type: "input_image",
      image_url: image,
    });
  }

  return {
    type: "message",
    role: "user",
    content,
  };
}

export function createFunctionCallOutputItem(callId: string, output: string): AgentInputItem {
  return {
    type: "function_call_output",
    call_id: callId,
    output,
  };
}

export function runJavascriptToolDefinition() {
  return {
    type: "function",
    name: "run_javascript",
    description: "Run JavaScript against the live Maputnik runtime. Use it for calculations, statistics, and live-state inspection instead of estimating.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute in the live runtime.",
        },
      },
      required: ["code"],
    },
  };
}

export async function callResponsesApi(
  settings: AgentSettings,
  instructions: string,
  input: AgentInputItem[]
): Promise<AgentApiResponse> {
  const endpoint = normalizeEndpoint(settings.endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      instructions,
      input,
      tools: [runJavascriptToolDefinition()],
      tool_choice: "auto",
      stream: false,
    }),
  });

  if (!response.ok) {
    let message = `Responses API request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.error?.message) {
        message = body.error.message;
      }
    }
    catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<AgentApiResponse>;
}

function parseSseBlock(block: string): AgentStreamEvent | null {
  let type = "message";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    }
    else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  let data: any;
  try {
    data = JSON.parse(dataLines.join("\n"));
  }
  catch {
    data = dataLines.join("\n");
  }

  return {type, data};
}

export async function* streamResponsesApi(
  settings: AgentSettings,
  instructions: string,
  input: AgentInputItem[]
): AsyncGenerator<AgentStreamEvent> {
  const endpoint = normalizeEndpoint(settings.endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      instructions,
      input,
      tools: [runJavascriptToolDefinition()],
      tool_choice: "auto",
      stream: true,
    }),
  });

  if (!response.ok) {
    let message = `Responses API request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.error?.message) {
        message = body.error.message;
      }
    }
    catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Responses API did not return a readable stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const {done, value} = await reader.read();
    buffer += decoder.decode(value, {stream: !done});

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) {
        yield event;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event) {
      yield event;
    }
  }
}
