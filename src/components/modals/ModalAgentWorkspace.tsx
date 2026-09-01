import React from "react";
import {MdChat, MdClose, MdFileDownload, MdStorage} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map, StyleSpecification} from "maplibre-gl";

import {AgentConsole} from "../AgentConsole";
import {DatasetPanel} from "../DatasetPanel";
import {AgentExportPanel} from "../AgentExportPanel";
import type {DatasetStore} from "../../libs/dataset-store";

type ModalAgentWorkspaceInternalProps = {
  isOpen: boolean;
  onOpenToggle(): void;
  getMap(): Map | null;
  getStyle(): StyleSpecification;
  setStyle(style: StyleSpecification): void;
  datasetStore: DatasetStore;
  onDatasetsChange(): void;
  renderer: "mlgljs" | "ol";
} & WithTranslation;

type ModalAgentWorkspaceInternalState = {
  view: "chat" | "data" | "export";
};

class ModalAgentWorkspaceInternal extends React.Component<ModalAgentWorkspaceInternalProps, ModalAgentWorkspaceInternalState> {
  constructor(props: ModalAgentWorkspaceInternalProps) {
    super(props);
    this.state = {
      view: "chat",
    };
  }

  componentDidMount() {
    if (this.props.isOpen) {
      this.activateModal();
    }
  }

  componentDidUpdate(prevProps: ModalAgentWorkspaceInternalProps) {
    if (prevProps.isOpen === this.props.isOpen) {
      return;
    }
    if (this.props.isOpen) {
      this.activateModal();
    }
    else {
      this.deactivateModal();
    }
  }

  componentWillUnmount() {
    this.deactivateModal();
  }

  activateModal = () => {
    document.addEventListener("keydown", this.handleKeyDown);
    document.body.classList.add("maputnik-modal-open");
  };

  deactivateModal = () => {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.body.classList.remove("maputnik-modal-open");
  };

  handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.props.onOpenToggle();
    }
  };

  close = () => {
    this.props.onOpenToggle();
  };

  render() {
    const {t} = this.props;

    return <div className={`maputnik-agent-workspace-shell ${this.props.isOpen ? "maputnik-agent-workspace-shell--open" : ""}`}>
      {this.props.isOpen && <div
        className="maputnik-agent-workspace-backdrop"
        onClick={this.close}
        data-wd-key="modal:agent-workspace.backdrop"
      />}
      <div
        className="maputnik-modal maputnik-agent-workspace-modal"
        data-wd-key="modal:agent-workspace"
        role="dialog"
        aria-modal="true"
      >
        <header className="maputnik-modal-header">
          <h1 className="maputnik-modal-header-title">{t("Agent Workspace")}</h1>
          <span className="maputnik-space"></span>
          <button
            className="maputnik-modal-header-toggle"
            title={t("Close modal")}
            onClick={this.close}
            data-wd-key="modal:agent-workspace.close-modal"
          >
            <MdClose />
          </button>
        </header>
        <div className="maputnik-modal-scroller">
          <div className="maputnik-modal-content">
            <div className="agent-workspace-tabs">
              <button
                className={`maputnik-button maputnik-button--with-icon agent-workspace-tab ${this.state.view === "chat" ? "maputnik-button-selected" : ""}`}
                onClick={() => this.setState({view: "chat"})}
                data-wd-key="agent-workspace:tab-chat"
              >
                <MdChat />
                {t("Chat")}
              </button>
              <button
                className={`maputnik-button maputnik-button--with-icon agent-workspace-tab ${this.state.view === "data" ? "maputnik-button-selected" : ""}`}
                onClick={() => this.setState({view: "data"})}
                data-wd-key="agent-workspace:tab-data"
              >
                <MdStorage />
                {t("Data")}
              </button>
              <button
                className={`maputnik-button maputnik-button--with-icon agent-workspace-tab ${this.state.view === "export" ? "maputnik-button-selected" : ""}`}
                onClick={() => this.setState({view: "export"})}
                data-wd-key="agent-workspace:tab-export"
              >
                <MdFileDownload />
                {t("Export")}
              </button>
            </div>

            <div className={`agent-workspace-view ${this.state.view === "chat" ? "agent-workspace-view--active" : ""}`}>
              <AgentConsole
                getMap={this.props.getMap}
                getStyle={this.props.getStyle}
                setStyle={this.props.setStyle}
                datasetStore={this.props.datasetStore}
                onOpenData={() => this.setState({view: "data"})}
                renderer={this.props.renderer}
              />
            </div>
            <div className={`agent-workspace-view ${this.state.view === "data" ? "agent-workspace-view--active" : ""}`}>
              <DatasetPanel
                store={this.props.datasetStore}
                onDatasetsChange={this.props.onDatasetsChange}
              />
            </div>
            <div className={`agent-workspace-view ${this.state.view === "export" ? "agent-workspace-view--active" : ""}`}>
              <AgentExportPanel
                map={this.props.getMap()}
                renderer={this.props.renderer}
                styleName={this.props.getStyle().name ?? "maputnik"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>;
  }
}

export const ModalAgentWorkspace = withTranslation()(ModalAgentWorkspaceInternal);
