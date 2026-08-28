import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
} from "./agent-overlay";

export const AGENT_EXPORT_SCALE = 2;

export type ExportLayerMode = "base" | "overlay";

export type ExportLayer = {
  id: string;
  metadata?: Record<string, unknown>;
  layout?: {
    visibility?: "visible" | "none";
  };
};

export type ExportLayerVisibility = "visible" | "none";

export type ExportVisibilityPlan = {
  hide: string[];
  restore: Array<{
    id: string;
    visibility: ExportLayerVisibility;
  }>;
};

export function isAgentOverlayLayerId(id: string) {
  return id.startsWith(AGENT_OVERLAY_LAYER_PREFIX);
}

export function isAgentOverlayLayer(layer: ExportLayer) {
  return isAgentOverlayLayerId(layer.id) || layer.metadata?.[AGENT_OVERLAY_METADATA_KEY] === AGENT_OVERLAY_ROLE;
}

export function layerVisibility(layer: ExportLayer): ExportLayerVisibility {
  return layer.layout?.visibility === "none" ? "none" : "visible";
}

export function createExportVisibilityPlan(
  layers: readonly ExportLayer[],
  mode: ExportLayerMode
): ExportVisibilityPlan {
  const normalizedLayers = layers ?? [];
  const hide = normalizedLayers
    .filter(layer => mode === "base" ? isAgentOverlayLayer(layer) : !isAgentOverlayLayer(layer))
    .map(layer => layer.id);
  const restore = normalizedLayers.map(layer => ({
    id: layer.id,
    visibility: layerVisibility(layer),
  }));

  return {hide, restore};
}
