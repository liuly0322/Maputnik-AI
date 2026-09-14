import type {TFunction} from "i18next";
import {Accordion} from "react-accessible-accordion";

import {CollapsibleGroup} from "./CollapsibleGroup";
import {DatasetPanel} from "./DatasetPanel";
import type {DatasetStore} from "../libs/dataset-store";

const SETTINGS_GROUP = "agent-settings";
const DATA_GROUP = "agent-data";

type AgentConsoleGroupsProps = {
  t: TFunction;
  settings: {
    apiKey: string;
    endpoint: string;
    model: string;
  };
  datasetStore: DatasetStore;
  onSettingsChange(key: "apiKey" | "endpoint" | "model", value: string): void;
};

/**
 * The console's configuration, as collapsible groups sharing the layer
 * editor's group styling. Both start closed: the conversation below is what
 * the panel is for, and these are what you open when you need them.
 */
export function AgentConsoleGroups(props: AgentConsoleGroupsProps) {
  const {t} = props;

  return <Accordion
    allowMultipleExpanded={true}
    allowZeroExpanded={true}
  >
    <CollapsibleGroup
      id={SETTINGS_GROUP}
      testIdPrefix="agent-console-group"
      data-wd-key="API settings"
      title={t("API settings")}
    >
      <div className="agent-console-group-panel agent-console-settings">
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
      </div>
    </CollapsibleGroup>

    <CollapsibleGroup
      id={DATA_GROUP}
      testIdPrefix="agent-console-group"
      data-wd-key="Data"
      title={t("Data")}
    >
      <DatasetPanel store={props.datasetStore} />
    </CollapsibleGroup>
  </Accordion>;
}
