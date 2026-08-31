import React from "react";
import {MdArrowBack, MdDelete, MdFileUpload} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";

import {InputButton} from "./InputButton";
import type {Dataset} from "../libs/dataset";
import type {DatasetStore} from "../libs/dataset-store";

type DatasetPanelInternalProps = {
  store: DatasetStore;
  onDatasetsChange(): void;
  onBack(): void;
} & WithTranslation;

type DatasetPanelInternalState = {
  error?: string;
  busy: boolean;
};

function getDatasetDisplay(dataset: Dataset) {
  switch (dataset.type) {
    case "csv":
      return {
        rowCount: dataset.data.rows.length,
        columns: dataset.data.columns,
      };
  }
}

class DatasetPanelInternal extends React.Component<DatasetPanelInternalProps, DatasetPanelInternalState> {
  private fileInputRef = React.createRef<HTMLInputElement>();

  constructor(props: DatasetPanelInternalProps) {
    super(props);
    this.state = {
      busy: false,
    };
  }

  onBrowseClick = () => {
    this.fileInputRef.current?.click();
  };

  onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    this.setState({busy: true, error: undefined});
    try {
      const text = await file.text();
      await this.props.store.addCsv(file.name, text);
      this.props.onDatasetsChange();
    }
    catch (error) {
      this.setState({error: error instanceof Error ? error.message : String(error)});
    }
    finally {
      this.setState({busy: false});
      event.target.value = "";
    }
  };

  onRemove = async (id: string) => {
    this.setState({error: undefined});
    try {
      await this.props.store.remove(id);
      this.props.onDatasetsChange();
    }
    catch (error) {
      this.setState({error: error instanceof Error ? error.message : String(error)});
    }
  };

  render() {
    const {t} = this.props;
    const datasets = this.props.store.getAll();

    return <div className="dataset-panel" data-wd-key="agent-workspace:data">
      <div className="dataset-panel-toolbar">
        <button className="maputnik-button maputnik-button--with-icon" onClick={this.props.onBack} data-wd-key="agent-workspace:back-to-chat">
          <MdArrowBack />
          {t("Back to Agent")}
        </button>
      </div>

      <section className="maputnik-modal-section">
        <h1>{t("CSV datasets")}</h1>
        <p>{t("Upload a CSV file. The agent can inspect its columns and rows without assuming which columns are coordinates.")}</p>
        <input
          ref={this.fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{display: "none"}}
          onChange={this.onFileChange}
          data-wd-key="datasets:file-input"
        />
        <InputButton className="maputnik-button--with-icon" onClick={this.onBrowseClick} data-wd-key="datasets:upload">
          <MdFileUpload />
          {t("Upload CSV")}
        </InputButton>
        {this.state.busy && <p>{t("Uploading...")}</p>}
        {this.state.error && <p className="maputnik-modal-error">{this.state.error}</p>}
      </section>

      <section className="maputnik-modal-section">
        <h1>{t("Loaded datasets")}</h1>
        {datasets.length === 0 && <p>{t("No datasets yet.")}</p>}
        <div className="maputnik-dataset-list" data-wd-key="datasets:list">
          {datasets.map(dataset => {
            const display = getDatasetDisplay(dataset);
            return <div className="maputnik-dataset-item" key={dataset.id} data-wd-key={`datasets:item:${dataset.id}`}>
              <div className="maputnik-dataset-item-main">
                <div className="maputnik-dataset-item-name">{dataset.name}</div>
                <div className="maputnik-dataset-item-meta">
                  {display.rowCount} {t("rows")} · {display.columns.join(", ")}
                </div>
              </div>
              <InputButton
                onClick={() => void this.onRemove(dataset.id)}
                aria-label={t("Remove dataset")}
                className="maputnik-button--with-icon"
                data-wd-key={`datasets:remove:${dataset.id}`}
              >
                <MdDelete />
              </InputButton>
            </div>;
          })}
        </div>
      </section>
    </div>;
  }
}

export const DatasetPanel = withTranslation()(DatasetPanelInternal);
