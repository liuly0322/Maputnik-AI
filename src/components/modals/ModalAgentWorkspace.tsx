import React from "react";
import {MdChat, MdClose, MdFileDownload, MdStorage} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map} from "maplibre-gl";

import {AgentConsole} from "../AgentConsole";
import {DatasetPanel} from "../DatasetPanel";
import {AgentExportPanel} from "../AgentExportPanel";
import type {AgentRuntime} from "../../libs/agent-runtime";
import type {DatasetStore} from "../../libs/dataset-store";

type ModalAgentWorkspaceInternalProps = {
  isOpen: boolean;
  onOpenToggle(): void;
  runtime: AgentRuntime;
  datasetStore: DatasetStore;
  onDatasetsChange(): void;
  map: Map | null;
  renderer: string;
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
                className={`agent-workspace-tab ${this.state.view === "chat" ? "agent-workspace-tab--active" : ""}`}
                onClick={() => this.setState({view: "chat"})}
                data-wd-key="agent-workspace:tab-chat"
              >
                <MdChat />
                {t("Chat")}
              </button>
              <button
                className={`agent-workspace-tab ${this.state.view === "data" ? "agent-workspace-tab--active" : ""}`}
                onClick={() => this.setState({view: "data"})}
                data-wd-key="agent-workspace:tab-data"
              >
                <MdStorage />
                {t("Data")}
              </button>
              <button
                className={`agent-workspace-tab ${this.state.view === "export" ? "agent-workspace-tab--active" : ""}`}
                onClick={() => this.setState({view: "export"})}
                data-wd-key="agent-workspace:tab-export"
              >
                <MdFileDownload />
                {t("Export")}
              </button>
            </div>

            <div className={`agent-workspace-view ${this.state.view === "chat" ? "agent-workspace-view--active" : ""}`}>
              <AgentConsole
                runtime={this.props.runtime}
                datasetStore={this.props.datasetStore}
                onDatasetsChange={this.props.onDatasetsChange}
                onOpenData={() => this.setState({view: "data"})}
              />
            </div>
            <div className={`agent-workspace-view ${this.state.view === "data" ? "agent-workspace-view--active" : ""}`}>
              <DatasetPanel
                store={this.props.datasetStore}
                onDatasetsChange={this.props.onDatasetsChange}
                onBack={() => this.setState({view: "chat"})}
              />
            </div>
            <div className={`agent-workspace-view ${this.state.view === "export" ? "agent-workspace-view--active" : ""}`}>
              <AgentExportPanel
                map={this.props.map}
                renderer={this.props.renderer}
                styleName={this.props.runtime.getStyle().name ?? "maputnik"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>;
  }
}

export const ModalAgentWorkspace = withTranslation()(ModalAgentWorkspaceInternal);
