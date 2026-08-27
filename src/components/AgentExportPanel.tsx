import React from "react";
import {MdFileDownload, MdLayers, MdMap} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map} from "maplibre-gl";

import {InputButton} from "./InputButton";
import {
  AGENT_EXPORT_SCALE,
  createExportVisibilityPlan,
  type ExportLayer,
  type ExportLayerMode,
  type ExportVisibilityPlan,
} from "../libs/agent-export";

type AgentExportPanelInternalProps = {
  map: Map | null;
  renderer: string;
  styleName: string;
} & WithTranslation;

type AgentExportPanelInternalState = {
  busy: boolean;
  error?: string;
  status?: string;
};

function waitForMapIdle(map: Map) {
  return new Promise<void>((resolve) => {
    map.once("idle", () => resolve());
    map.triggerRepaint();
  });
}

async function waitForMapSettled(map: Map) {
  if (!map.isStyleLoaded()) {
    await new Promise<void>((resolve) => {
      map.once("style.load", () => resolve());
    });
  }
  await waitForMapIdle(map);
}

function setLayerVisibility(map: Map, id: string, visibility: "visible" | "none") {
  if (!map.getLayer(id)) {
    return;
  }
  map.setLayoutProperty(id, "visibility", visibility);
}

function restoreLayerVisibility(map: Map, plan: ExportVisibilityPlan) {
  for (const layer of plan.restore) {
    setLayerVisibility(map, layer.id, layer.visibility);
  }
}

function createExportCanvas(map: Map) {
  const container = map.getContainer();
  const sourceCanvas = map.getCanvas();
  if (!container || !sourceCanvas) {
    return null;
  }

  const width = Math.max(1, Math.round(container.clientWidth * AGENT_EXPORT_SCALE));
  const height = Math.max(1, Math.round(container.clientHeight * AGENT_EXPORT_SCALE));
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;

  const ctx = out.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);
  return out;
}

async function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, "image/png");
  });
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  if (blob) {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function exportBaseName(styleName: string) {
  return (styleName || "maputnik").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

class AgentExportPanelInternal extends React.Component<AgentExportPanelInternalProps, AgentExportPanelInternalState> {
  private exporting = false;

  constructor(props: AgentExportPanelInternalProps) {
    super(props);
    this.state = {
      busy: false,
    };
  }

  onExport = async (mode: ExportLayerMode): Promise<boolean> => {
    const {map, renderer} = this.props;
    if (!map || this.exporting || renderer !== "mlgljs") {
      return false;
    }

    this.exporting = true;
    this.setState({
      busy: true,
      error: undefined,
      status: mode === "base" ? "Generating base map..." : "Generating overlay...",
    });

    let plan: ExportVisibilityPlan | null = null;
    try {
      const style = map.getStyle();
      if (!style) {
        throw new Error("Live map style is not ready");
      }

      plan = createExportVisibilityPlan(
        (style.layers ?? []) as ExportLayer[],
        mode
      );

      await waitForMapSettled(map);
      for (const id of plan.hide) {
        setLayerVisibility(map, id, "none");
      }
      await waitForMapIdle(map);

      const canvas = createExportCanvas(map);
      if (!canvas) {
        throw new Error("Could not create export canvas");
      }
      await downloadCanvas(canvas, `${exportBaseName(this.props.styleName)}-${mode}.png`);
      this.setState({status: "Export complete"});
      return true;
    }
    catch (error) {
      this.setState({error: error instanceof Error ? error.message : String(error)});
      return false;
    }
    finally {
      if (plan) {
        restoreLayerVisibility(map, plan);
        try {
          await waitForMapIdle(map);
        }
        catch {
          // Restoring the live map is best-effort after an export failure.
        }
      }
      this.exporting = false;
      this.setState({busy: false});
    }
  };

  onExportBoth = async () => {
    const baseExported = await this.onExport("base");
    if (baseExported) {
      await this.onExport("overlay");
    }
  };

  render() {
    const {t} = this.props;
    const liveMap = this.props.renderer === "mlgljs" && this.props.map;
    const disabled = !liveMap || this.state.busy;

    return <div className="agent-export-panel" data-wd-key="agent-workspace:export">
      <section className="maputnik-modal-section">
        <h1>{t("PNG Export")}</h1>
        <p>
          {t("Exports the current live map as separate base and overlay PNGs. Overlay layers are identified by the agent-dataset: prefix.")}
        </p>
        <p>
          {liveMap ? t("Live map is attached.") : t("Waiting for the map to load...")}
        </p>

        <div className="agent-export-actions">
          <InputButton
            onClick={() => void this.onExport("base")}
            disabled={disabled}
            data-wd-key="agent-export:base"
          >
            <MdMap />
            {t("Download base")}
          </InputButton>
          <InputButton
            onClick={() => void this.onExport("overlay")}
            disabled={disabled}
            data-wd-key="agent-export:overlay"
          >
            <MdLayers />
            {t("Download overlay")}
          </InputButton>
          <InputButton
            onClick={() => void this.onExportBoth()}
            disabled={disabled}
            data-wd-key="agent-export:both"
          >
            <MdFileDownload />
            {t("Download both")}
          </InputButton>
        </div>

        {this.state.status && <p className="agent-export-status" data-wd-key="agent-export:status">{this.state.status}</p>}
        {this.state.error && <p className="maputnik-modal-error" data-wd-key="agent-export:error">{this.state.error}</p>}
      </section>
    </div>;
  }
}

export const AgentExportPanel = withTranslation()(AgentExportPanelInternal);
