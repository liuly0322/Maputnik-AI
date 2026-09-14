import {
  AGENT_OVERLAY_LAYER_PREFIX,
  AGENT_OVERLAY_METADATA_KEY,
  AGENT_OVERLAY_ROLE,
} from "./agent-overlay";

export const AGENT_EXPORT_SCALE = 2;

/**
 * `composite` keeps the map as it looks: base and overlay layers together.
 * `base` and `overlay` split the two apart, which is what the overlay markers
 * below are for.
 */
export type ExportLayerMode = "base" | "overlay" | "composite";

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

function isAgentOverlayLayer(layer: ExportLayer) {
  return layer.id.startsWith(AGENT_OVERLAY_LAYER_PREFIX)
    || layer.metadata?.[AGENT_OVERLAY_METADATA_KEY] === AGENT_OVERLAY_ROLE;
}

function layerVisibility(layer: ExportLayer): ExportLayerVisibility {
  return layer.layout?.visibility === "none" ? "none" : "visible";
}

export function createExportVisibilityPlan(
  layers: readonly ExportLayer[],
  mode: ExportLayerMode
): ExportVisibilityPlan {
  // A composite export hides nothing, so it never touches layer visibility.
  const hide = mode === "composite"
    ? []
    : layers
      .filter(layer => mode === "base" ? isAgentOverlayLayer(layer) : !isAgentOverlayLayer(layer))
      .map(layer => layer.id);
  const restore = layers.map(layer => ({
    id: layer.id,
    visibility: layerVisibility(layer),
  }));

  return {hide, restore};
}
