import React from "react";
import {MdFileDownload, MdLayers, MdMap} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map} from "maplibre-gl";

import {InputButton} from "./InputButton";
import {
  AGENT_EXPORT_PIXEL_RATIO,
  createExportVisibilityPlan,
  type ExportLayer,
  type ExportLayerMode,
  type ExportVisibilityPlan,
} from "../libs/agent-export";
import {describeLiveMap} from "../libs/agent-panel";

type AgentExportPanelInternalProps = {
  map: Map | null;
  renderer: "mlgljs" | "ol";
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

/**
 * Renders the map at `pixelRatio` and copies the result before putting the map
 * back. The copy is not optional: restoring the ratio resizes the canvas this
 * is reading from. A map already drawing at least this densely — a HiDPI
 * screen, say — is taken as it stands rather than re-rendered.
 */
async function captureAtPixelRatio(map: Map, pixelRatio: number) {
  const previous = map.getPixelRatio();
  if (previous >= pixelRatio) {
    return copyCanvas(map.getCanvas());
  }

  map.setPixelRatio(pixelRatio);
  try {
    await waitForMapSettled(map);
    await waitForMapIdle(map);
    return copyCanvas(map.getCanvas());
  }
  finally {
    map.setPixelRatio(previous);
  }
}

/** A plain copy, at the source's own resolution. */
function copyCanvas(source: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;

  const ctx = out.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(source, 0, 0);
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
    const statusByMode: Record<ExportLayerMode, string> = {
      composite: this.props.t("Generating composite..."),
      base: this.props.t("Generating base map..."),
      overlay: this.props.t("Generating overlay..."),
    };
    this.setState({
      busy: true,
      error: undefined,
      status: statusByMode[mode],
    });

    let plan: ExportVisibilityPlan | null = null;
    try {
      plan = createExportVisibilityPlan(
        map.getStyle().layers as ExportLayer[],
        mode
      );

      await waitForMapSettled(map);
      for (const id of plan.hide) {
        setLayerVisibility(map, id, "none");
      }
      await waitForMapIdle(map);

      const canvas = await captureAtPixelRatio(map, AGENT_EXPORT_PIXEL_RATIO);
      if (!canvas) {
        throw new Error(this.props.t("Could not create export canvas"));
      }
      await downloadCanvas(canvas, `${exportBaseName(this.props.styleName)}-${mode}.png`);
      this.setState({status: this.props.t("Export complete")});
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

    return <div className="agent-export-panel" data-wd-key="agent-export">
      <section className="maputnik-modal-section">
        <p className="agent-export-description">
          {t("Exports the current live map as PNG. The composite image keeps every layer; the base and overlay images split them apart. Historical overlays are identified by the agent-dataset: prefix or maputnik:role metadata.")}
        </p>
        <div className="maputnik-expr-infobox agent-export-note">
          <MdLayers />
          <p>{t("Tip: Set a layer ID beginning with agent-dataset: to force it into the overlay export.")}</p>
        </div>
        <p className="agent-export-map-status" data-wd-key="agent-export:map-status">
          {describeLiveMap(t, this.props.renderer, this.props.map)}
        </p>

        <div className="agent-export-actions">
          <InputButton
            className="maputnik-button--with-icon maputnik-white-button"
            onClick={() => void this.onExport("composite")}
            disabled={disabled}
            data-wd-key="agent-export:composite"
          >
            <MdFileDownload />
            {t("Download composite")}
          </InputButton>
          <InputButton
            className="maputnik-button--with-icon"
            onClick={() => void this.onExport("base")}
            disabled={disabled}
            data-wd-key="agent-export:base"
          >
            <MdMap />
            {t("Download base")}
          </InputButton>
          <InputButton
            className="maputnik-button--with-icon"
            onClick={() => void this.onExport("overlay")}
            disabled={disabled}
            data-wd-key="agent-export:overlay"
          >
            <MdLayers />
            {t("Download overlay")}
          </InputButton>
          <InputButton
            className="maputnik-button--with-icon"
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
