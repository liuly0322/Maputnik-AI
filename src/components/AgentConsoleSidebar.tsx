import type {TFunction} from "i18next";
import {MdAdd, MdChevronLeft, MdChevronRight, MdDelete} from "react-icons/md";

import type {AgentConsoleSession} from "../libs/agent-conversation";
import type {Dataset} from "../libs/dataset";
import type {DatasetStore} from "../libs/dataset-store";

type AgentConsoleSidebarProps = {
  t: TFunction;
  open: boolean;
  settingsOpen: boolean;
  settings: {
    apiKey: string;
    endpoint: string;
    model: string;
  };
  mapStatus: string;
  sessions: AgentConsoleSession[];
  sessionsReady: boolean;
  activeSessionId: string | null;
  datasetStore: DatasetStore;
  onToggle(): void;
  onToggleSettings(): void;
  onSettingsChange(key: "apiKey" | "endpoint" | "model", value: string): void;
  onNewSession(): void;
  onSelectSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
  onOpenData(): void;
};

function getDatasetCsvSummary(dataset: Dataset) {
  switch (dataset.type) {
    case "csv":
      return {
        rowCount: dataset.data.rows.length,
        columns: dataset.data.columns,
      };
  }
}

export function AgentConsoleSidebar(props: AgentConsoleSidebarProps) {
  const {t} = props;
  const datasets = props.datasetStore.getAll();

  return <div className="agent-console-sidebar-slot">
    <aside
      className={`agent-console-sidebar ${props.open ? "agent-console-sidebar--open" : ""}`}
      data-wd-key="agent-console:sidebar"
      id="agent-console-sidebar"
    >
      <div className="agent-console-sidebar-header">
        <span>{t("Controls")}</span>
        <button
          className="maputnik-button agent-console-sidebar-toggle"
          onClick={props.onToggle}
          title={props.open ? t("Collapse controls") : t("Expand controls")}
          aria-label={props.open ? t("Collapse controls") : t("Expand controls")}
          aria-expanded={props.open}
          aria-controls="agent-console-sidebar"
          data-wd-key="agent-console:toggle-sidebar"
        >
          {props.open ? <MdChevronLeft /> : <MdChevronRight />}
        </button>
      </div>
      {props.open && <div className="agent-console-sidebar-content">
        <div className="agent-console-controls">
          <section className="agent-console-control-block">
            <div className="agent-console-settings-header">
              <h1>{t("Agent settings")}</h1>
              <button className="maputnik-button" onClick={props.onToggleSettings} data-wd-key="agent-console:toggle-settings">
                {props.settingsOpen ? t("Hide") : t("Settings")}
              </button>
            </div>
            {props.settingsOpen && <div className="agent-console-settings">
              <label>
                <span>{t("API key")}</span>
                <input
                  type="password"
                  value={props.settings.apiKey}
                  onChange={event => props.onSettingsChange("apiKey", event.target.value)}
                  data-wd-key="agent-console:api-key"
                />
              </label>
              <label>
                <span>{t("Endpoint")}</span>
                <input
                  type="text"
                  value={props.settings.endpoint}
                  onChange={event => props.onSettingsChange("endpoint", event.target.value)}
                  data-wd-key="agent-console:endpoint"
                />
              </label>
              <label>
                <span>{t("Model")}</span>
                <input
                  type="text"
                  value={props.settings.model}
                  onChange={event => props.onSettingsChange("model", event.target.value)}
                  data-wd-key="agent-console:model"
                />
              </label>
            </div>}
            <p data-wd-key="agent-console:map-status">{props.mapStatus}</p>
          </section>

          <section className="agent-console-control-block">
            <div className="agent-console-sessions-header">
              <h1>{t("Sessions")}</h1>
              <button className="maputnik-button agent-console-header-action" onClick={props.onNewSession} disabled={!props.sessionsReady} data-wd-key="agent-console:new-session">
                <MdAdd />
                {t("New session")}
              </button>
            </div>
            <div className="agent-console-sessions" data-wd-key="agent-console:sessions">
              {props.sessions.length === 0 && <p>{t("No sessions yet.")}</p>}
              {props.sessions.map(session => <div
                className={`agent-console-session ${session.id === props.activeSessionId ? "agent-console-session--active" : ""}`}
                key={session.id}
                data-wd-key={`agent-console:session:${session.id}`}
              >
                <button
                  className="agent-console-session-select"
                  onClick={() => props.onSelectSession(session.id)}
                >
                  {session.title}
                </button>
                <button
                  className="agent-console-session-delete"
                  onClick={() => props.onDeleteSession(session.id)}
                  aria-label={t("Delete session")}
                  data-wd-key={`agent-console:delete-session:${session.id}`}
                >
                  <MdDelete />
                </button>
              </div>)}
            </div>
          </section>

          <section className="agent-console-control-block">
            <div className="agent-console-context-header">
              <h1>{t("Dataset context")}</h1>
              <button className="maputnik-button agent-console-header-action" onClick={props.onOpenData} data-wd-key="agent-console:manage-data">
                {t("Manage data")}
              </button>
            </div>
            <div className="agent-console-dataset-chips" data-wd-key="agent-console:dataset-chips">
              {datasets.length === 0 && <p>{t("No datasets loaded.")}</p>}
              {datasets.map(dataset => {
                const summary = getDatasetCsvSummary(dataset);
                return <div
                  key={dataset.id}
                  className="agent-console-dataset-chip"
                  data-wd-key={`agent-console:dataset-chip:${dataset.id}`}
                >
                  <span className="agent-console-dataset-chip-name">{dataset.name}</span>
                  <span className="agent-console-dataset-chip-meta">
                    {dataset.type} · {summary.rowCount} {t("rows")} · {summary.columns.slice(0, 4).join(", ")}
                  </span>
                </div>;
              })}
            </div>
          </section>
        </div>
      </div>}
    </aside>
  </div>;
}
