import type {Feature} from "geojson";
import type {LayerSpecification, Map, SourceSpecification, StyleSpecification} from "maplibre-gl";
import type {DatasetSummary, DatasetWorkspace, GeometryMapping} from "./dataset";
import {createBatchScheduler, createMapProxy, createStyleProxy} from "./agent-proxies";

export const AGENT_OVERLAY_LAYER_PREFIX = "agent-dataset:";
export const AGENT_OVERLAY_METADATA_KEY = "maputnik:role";
export const AGENT_OVERLAY_ROLE = "overlay";

export type AgentRuntimeViewport = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
};

export type AgentRuntimeSnapshot = {
  viewport: AgentRuntimeViewport;
  style: StyleSpecification;
  layers: LayerSpecification[];
  sources: Record<string, SourceSpecification>;
  selectedLayerIndex: number;
  selectedLayer: LayerSpecification | undefined;
  selection: Feature[];
  datasets: DatasetSummary[];
};

export type AgentRuntimeViewportUpdate = Partial<{
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}>;

export type AgentRuntime = {
  map: Map | null;
  style: StyleSpecification;
  datasets: DatasetWorkspace;
  getState(): AgentRuntimeSnapshot;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  setViewport(viewport: AgentRuntimeViewportUpdate): void;
  setSelection(selection: Feature[]): void;
  addDatasetLayer(
    datasetId: string,
    options: {
      geometry: GeometryMapping;
      type?: "circle" | "line" | "fill" | "symbol" | "heatmap";
      id?: string;
      paint?: LayerSpecification["paint"];
      layout?: LayerSpecification["layout"];
    }
  ): string;
  removeLayer(id: string): void;
};

type AgentRuntimeSnapshotArgs = {
  map: Map | null;
  style: StyleSpecification;
  selectedLayerIndex: number;
  selection: Feature[];
  datasets: DatasetSummary[];
};

export type AgentRuntimeFactoryArgs = {
  getMap(): Map | null;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  getSelectedLayerIndex(): number;
  getSelection(): Feature[];
  setSelection(selection: Feature[]): void;
  getDatasets(): DatasetSummary[];
  datasets: DatasetWorkspace;
};

export function createAgentRuntimeFactory(args: AgentRuntimeFactoryArgs): AgentRuntime {
  const scheduleStyleSync = createBatchScheduler(() => {
    const map = args.getMap();
    const style = map ? map.getStyle() : args.getStyle();
    args.setStyle(sanitizeStyle(style));
  });

  return {
    get map() {
      const map = args.getMap();
      return map ? createMapProxy(map, scheduleStyleSync) : null;
    },
    get style() {
      const style = args.getStyle();
      const commit = createBatchScheduler(() => args.setStyle(sanitizeStyle(style)));
      return createStyleProxy(style, commit);
    },
    datasets: args.datasets,
    getState: () => createAgentRuntimeSnapshot({
      map: args.getMap(),
      style: args.getStyle(),
      selectedLayerIndex: args.getSelectedLayerIndex(),
      selection: args.getSelection(),
      datasets: args.getDatasets(),
    }),
    getStyle: () => args.getStyle(),
    setStyle: style => args.setStyle(sanitizeStyle(style)),
    setViewport: viewport => {
      const map = args.getMap();
      if (!map) return;
      map.jumpTo({
        center: viewport.center,
        zoom: viewport.zoom,
        bearing: viewport.bearing,
        pitch: viewport.pitch,
      });
    },
    setSelection: selection => {
      args.setSelection(selection);
    },
    addDatasetLayer: (datasetId, options) => {
      const sourceId = `${AGENT_OVERLAY_LAYER_PREFIX}${datasetId}`;
      const style = args.getStyle();
      const nextStyle = structuredClone(style);
      nextStyle.sources = {
        ...nextStyle.sources,
        [sourceId]: {
          type: "geojson",
          data: args.datasets.toGeoJSON(datasetId, options.geometry),
        },
      };
      nextStyle.layers = [...(nextStyle.layers ?? [])];
      const requestedId = options.id?.trim();
      const layerId = requestedId
        ? requestedId.startsWith(AGENT_OVERLAY_LAYER_PREFIX)
          ? requestedId
          : `${AGENT_OVERLAY_LAYER_PREFIX}${requestedId}`
        : `${sourceId}-layer`;
      const layer: LayerSpecification = {
        id: layerId,
        type: options.type ?? "circle",
        source: sourceId,
        metadata: {
          [AGENT_OVERLAY_METADATA_KEY]: AGENT_OVERLAY_ROLE,
        },
      };
      if (options.paint) layer.paint = options.paint;
      if (options.layout) layer.layout = options.layout;
      nextStyle.layers.push(layer);
      args.setStyle(nextStyle);
      return layer.id;
    },
    removeLayer: id => {
      const style = args.getStyle();
      const nextStyle = structuredClone(style);
      nextStyle.layers = (nextStyle.layers ?? []).filter(layer => layer.id !== id);
      args.setStyle(nextStyle);
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function defaultBounds() {
  return {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  };
}

export function createAgentRuntimeSnapshot(args: AgentRuntimeSnapshotArgs): AgentRuntimeSnapshot {
  const {map, style, selectedLayerIndex, selection} = args;

  let viewport: AgentRuntimeViewport;
  if (map) {
    const center = map.getCenter();
    const bounds = map.getBounds();
    viewport = {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
    };
  }
  else {
    const styleCenter = style.center;
    viewport = {
      center: styleCenter ? [styleCenter[0], styleCenter[1]] : [0, 0],
      zoom: style.zoom ?? 0,
      bearing: 0,
      pitch: 0,
      bounds: defaultBounds(),
    };
  }

  const layers = style.layers ?? [];
  const clonedLayers = cloneJson(layers);

  return {
    viewport,
    style: cloneJson(style),
    layers: clonedLayers,
    sources: cloneJson(style.sources ?? {}),
    selectedLayerIndex,
    selectedLayer: clonedLayers[selectedLayerIndex],
    selection: cloneJson(selection),
    datasets: cloneJson(args.datasets),
  };
}
