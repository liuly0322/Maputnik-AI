import type {TFunction} from "i18next";
import type {Map} from "maplibre-gl";

/**
 * The agent workspace is a resizable column docked beside the map rather than a
 * modal, so its width is runtime state that the stylesheets pick up through the
 * `--layout-agent-width` custom property. This module holds the pieces both the
 * panel and the export modal need from that setup.
 */

export const AGENT_PANEL_DEFAULT_WIDTH = 520;

/** Below this the conversation, its code blocks and the composer stop fitting. */
export const AGENT_PANEL_MIN_WIDTH = 500;

export const AGENT_PANEL_MAX_WIDTH = 900;

const STORAGE_KEY = "maputnik:agent-panel-width";

/**
 * Whether the agent has a live map to work with, shared by the workspace and
 * export status lines so they cannot drift apart.
 */
export function describeLiveMap(t: TFunction, renderer: "mlgljs" | "ol", map: Map | null) {
  if (renderer !== "mlgljs") {
    return t("Live map access requires the MapLibreGL JS renderer. Switch the style renderer in Settings.");
  }
  return map ? t("Live map is attached.") : t("Waiting for the map to load...");
}

export function clampAgentPanelWidth(width: number) {
  if (!Number.isFinite(width)) {
    return AGENT_PANEL_DEFAULT_WIDTH;
  }
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)));
}

export function loadAgentPanelWidth(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return AGENT_PANEL_DEFAULT_WIDTH;
    }
    return clampAgentPanelWidth(Number(stored));
  }
  catch {
    // Storage can be unavailable (private mode, opaque origin); the default wins.
    return AGENT_PANEL_DEFAULT_WIDTH;
  }
}

export function saveAgentPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampAgentPanelWidth(width)));
  }
  catch {
    // A failed write only costs the remembered width, so it stays silent.
  }
}
