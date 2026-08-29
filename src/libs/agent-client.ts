import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
} from "./agent-overlay";
import { DATASET_TYPE_REFERENCE, type Dataset } from "./dataset";

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

export const DATASET_WORKFLOW_EXAMPLE = `/**
 * Dev example only. Collect enough data before actual operation in real case.
 */
const datasetId = "<exact ID from the dataset catalog>";
const dataset = datasets.get(datasetId);

const pointData = datasets.csv.toGeoJSON(dataset, {
  type: "Point",
  // use real column names from the dataset for coordinates
  // supposing the demo dataset has 3 columns: lon, lat, value
  coordinates: ["lon", "lat"]
});

const processedData = {
  type: "FeatureCollection",
  features: pointData.features
    .filter(feature => Number(feature.properties?.value) > 10)
    .map(feature => ({
      ...feature,
      properties: {
        ...feature.properties,
        normalizedValue: Number(feature.properties?.value) / 100
      }
    }))
};

const sourceId = \`${AGENT_OVERLAY_LAYER_PREFIX}\${datasetId}:normalized-values\`;
const layerId = \`${AGENT_OVERLAY_LAYER_PREFIX}\${datasetId}:normalized-value-circles\`;

style.sources[sourceId] = {
  type: "geojson",
  data: processedData
};

style.layers = style.layers.filter(layer => layer.id !== layerId);
style.layers.push({
  id: layerId,
  type: "circle",
  source: sourceId,
  metadata: {
    "${AGENT_OVERLAY_METADATA_KEY}": "${AGENT_OVERLAY_ROLE}"
  },
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "normalizedValue"],
      0, 4,
      1, 16
    ],
    "circle-color": [
      "interpolate",
      ["linear"],
      ["get", "normalizedValue"],
      0, "#d9f0d3",
      1, "#238b45"
    ]
  }
});

const center = map.getCenter();
const createdLayer = style.layers.find(layer => layer.id === layerId);

return {
  dataset: {
    id: dataset.id,
    name: dataset.name,
    type: dataset.type,
    columns: dataset.data.columns,
    inputRowCount: dataset.data.rows.length,
    validPointFeatureCount: pointData.features.length,
    outputFeatureCount: processedData.features.length
  },
  map: {
    center: [center.lng, center.lat],
    zoom: map.getZoom()
  },
  style: {
    sourceCount: Object.keys(style.sources).length,
    layerCount: style.layers.length,
    createdLayer
  },
  overlayVerification: {
    layerIdHasPrefix: createdLayer.id.startsWith("${AGENT_OVERLAY_LAYER_PREFIX}"),
    role: createdLayer.metadata?.["${AGENT_OVERLAY_METADATA_KEY}"]
  }
};`;

export function buildAgentInstructions(datasets: readonly Dataset[]): string {
  const catalog = datasets.map(dataset => {
    const baseCatalogItem: Record<string, unknown> = {
      id: dataset.id,
      name: dataset.name,
      type: dataset.type,
      createdAt: dataset.createdAt,
    }
    if (dataset.type === "csv") {
      baseCatalogItem.columns = dataset.data.columns;
      baseCatalogItem.rowCount = dataset.data.rows.length;
    }
    return baseCatalogItem;
  });

  return `You are the built-in agent inside Maputnik. Use run_javascript to inspect and modify the live MapLibre map, the editable Maputnik style, and browser-local datasets.

# JavaScript environment

run_javascript executes asynchronous JavaScript and provides three objects:

- map: the live MapLibre Map instance. Use native MapLibre methods to inspect and control the viewport, read the effective rendered style, query rendered features, query source features, and inspect other live map state.
- style: a writable proxy for the current Maputnik style document. Use style.sources and style.layers to create, inspect, and modify sources and layers. Nested property assignments and array mutations are committed to the editor.
- datasets: the browser-local dataset workspace. Use exact catalog IDs with datasets.get(...), inspect dataset.type at runtime, and use type-specific helpers such as datasets.csv.toGeoJSON(...).

run_javascript supports await.

Prefer completing inspection, calculation, mutation, and verification in a single execution when the required state is already available. Split executions only when a later action genuinely depends on facts that must first be inspected.
End every execution with return. Return a compact JSON-serializable summary of the work completed, including relevant facts, calculation results, IDs created or changed, and verification evidence when applicable. Plain objects and arrays are serialized automatically.

# Dataset types

${DATASET_TYPE_REFERENCE}

For CSV datasets, columns define the index of each string value in every row. Cells remain strings, including empty cells. Use ordinary JavaScript array operations for indexing, filtering, mapping, aggregation, and derived calculations. Use Number(value) for JavaScript arithmetic and ["to-number", ["get", "column"]] inside MapLibre expressions.

datasets.csv.toGeoJSON(...) is a stateless CSV Point adapter. The selected coordinate columns become numeric Point coordinates and each source row is reconstructed in feature.properties.

A FeatureCollection<Point> can be filtered or mapped to create another FeatureCollection<Point>. Preserve standard GeoJSON geometry and place calculated fields in feature.properties.

# Working method

- Inspect the state relevant to the requested operation before modifying it.
- Use exact JavaScript calculations for counting, arithmetic, grouping, statistics, comparison, and verification.
- Identify the counting scope explicitly: style layers, rendered features, source features, and CSV dataset rows represent different quantities.
- Use map for live MapLibre state, viewport operations, and feature queries.
- Use style.sources and style.layers for declarative source and layer creation or modification.
- Use exact dataset IDs from the dataset catalog.
- Treat loaded datasets as inputs for inspection, analysis, conversion, and visualization.
- Give every new source and layer a unique, descriptive ID so one dataset can support multiple independent visualizations.
- Apply focused changes while preserving unrelated map and style state.
- When a task changes state, verify the affected result in the same execution when practical, and return concise verification information.
- Return summaries, counts, IDs, and selected fields rather than complete map, style, feature, or dataset objects.

# Dataset overlay rules

A dataset-related layer is any layer whose source, filter, styling, or visual encoding depends on a user-provided dataset.

Every new dataset-related layer is an overlay.

For every dataset-related layer:

- Set layer.id to a unique descriptive ID beginning with ${AGENT_OVERLAY_LAYER_PREFIX}.
- Set layer.metadata["${AGENT_OVERLAY_METADATA_KEY}"] to "${AGENT_OVERLAY_ROLE}".
- Use a unique descriptive source ID beginning with ${AGENT_OVERLAY_LAYER_PREFIX}.
- Preserve both markers when modifying or replacing the layer.
- Verify the prefix and metadata in style.layers before completing the task.

Base-map layers style backgrounds, tiles, roads, boundaries, labels, terrain, or other cartographic content that does not depend on a user-provided dataset.

# Dataset workflow example

${DATASET_WORKFLOW_EXAMPLE}

# Dataset catalog

${JSON.stringify(catalog, null, 2)}`;
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
    description: "Run asynchronous JavaScript with map, style, and datasets. Inspect or modify live Maputnik state and return a compact JSON-serializable result.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute. End with return; the returned value becomes the tool result.",
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

  return { type, data };
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
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

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
