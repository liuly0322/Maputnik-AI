import React from "react";
import {MdClose} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map, StyleSpecification} from "maplibre-gl";

import {AgentConsole} from "../AgentConsole";
import {ResizeHandle} from "../ResizeHandle";
import {DatasetStore} from "../../libs/dataset-store";
import {describeLiveMap} from "../../libs/agent-panel";

type AgentWorkspaceInternalProps = {
  onOpenToggle(): void;
  getMap(): Map | null;
  getMaputnikStyle(): StyleSpecification;
  updateMaputnikStyle(style: StyleSpecification): void;
  renderer: "mlgljs" | "ol";
  width: number;
  onWidthChange(width: number): void;
  onWidthCommit(width: number): void;
} & WithTranslation;

type AgentWorkspaceInternalState = {
  datasetStoreReady: boolean;
  datasetStoreError?: string;
};

/**
 * The agent workspace docks to the right of the map. It stays mounted while
 * closed — the layout collapses its column to zero width — so that the
 * conversation survives being toggled.
 */
class AgentWorkspaceInternal extends React.Component<AgentWorkspaceInternalProps, AgentWorkspaceInternalState> {
  private datasetStore = new DatasetStore();
  /**
   * The width most recently asked for. Committing has to carry it explicitly:
   * `onWidthChange` only schedules the state update, so reading the prop back
   * within the same tick would persist the previous width.
   */
  private requestedWidth: number;

  constructor(props: AgentWorkspaceInternalProps) {
    super(props);
    this.state = {
      datasetStoreReady: false,
    };
    this.requestedWidth = props.width;
  }

  componentDidMount() {
    void this.initializeDatasetStore();
  }

  initializeDatasetStore = async () => {
    try {
      await this.datasetStore.init();
      this.setState({datasetStoreReady: true});
    }
    catch (error) {
      console.error("Failed to initialize the dataset store", error);
      this.setState({
        datasetStoreReady: true,
        datasetStoreError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // The panel is pinned to the right edge of the viewport, so the pointer
  // position alone determines the requested width.
  onResizeDrag = (clientX: number) => {
    this.requestWidth(document.documentElement.clientWidth - clientX);
  };

  onResizeCommit = () => {
    this.props.onWidthCommit(this.requestedWidth);
  };

  private requestWidth(width: number) {
    this.requestedWidth = width;
    this.props.onWidthChange(width);
  }

  render() {
    const {t} = this.props;

    return <section className="agent-workspace-panel" data-wd-key="agent-workspace-panel">
      <ResizeHandle
        onDrag={this.onResizeDrag}
        onCommit={this.onResizeCommit}
      />
      <div className="layer-header">
        <h2 className="layer-header__title">{t("Agent Workspace")}</h2>
        <div className="layer-header__info">
          <button
            type="button"
            className="layer-header__collapse"
            title={t("Close agent workspace")}
            aria-label={t("Close agent workspace")}
            onClick={this.props.onOpenToggle}
            data-wd-key="agent-workspace-panel.close-modal"
          >
            <MdClose />
          </button>
        </div>
      </div>
      <p className="agent-workspace-map-status" data-wd-key="agent-console:map-status">
        {describeLiveMap(t, this.props.renderer, this.props.getMap())}
      </p>

      {!this.state.datasetStoreReady ? <div
        className="agent-console-generating agent-workspace-panel-loading"
        role="status"
        aria-live="polite"
      >
        <svg className="agent-console-generating-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>{t("Loading")}</span>
      </div> : <>
        {this.state.datasetStoreError && <p className="maputnik-modal-error" role="alert">
          {t("Dataset storage is unavailable")}: {this.state.datasetStoreError}
        </p>}
        <AgentConsole
          getMap={this.props.getMap}
          getMaputnikStyle={this.props.getMaputnikStyle}
          updateMaputnikStyle={this.props.updateMaputnikStyle}
          datasetStore={this.datasetStore}
        />
      </>}
    </section>;
  }
}

export const AgentWorkspacePanel = withTranslation()(AgentWorkspaceInternal);
