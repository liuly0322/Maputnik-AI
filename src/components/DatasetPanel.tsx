import React from "react";
import {MdDelete, MdFileUpload, MdFolderOpen, MdStorage} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";

import {InputButton} from "./InputButton";
import type {Dataset} from "../libs/dataset";
import type {DatasetStore} from "../libs/dataset-store";

type DatasetPanelInternalProps = {
  store: DatasetStore;
  onDatasetsChange(): void;
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
      <section className="maputnik-modal-section dataset-panel-section dataset-panel-upload-section">
        <div className="dataset-panel-section-header">
          <div>
            <div className="dataset-panel-eyebrow"><MdStorage /> {t("Data source")}</div>
            <h1>{t("CSV datasets")}</h1>
            <p className="dataset-panel-description">{t("Upload a CSV file. The agent can inspect its columns and rows without assuming which columns are coordinates.")}</p>
          </div>
          <InputButton className="maputnik-button--with-icon dataset-panel-upload-button" onClick={this.onBrowseClick} data-wd-key="datasets:upload">
            <MdFileUpload />
            {t("Upload CSV")}
          </InputButton>
        </div>
        <input
          ref={this.fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{display: "none"}}
          onChange={this.onFileChange}
          data-wd-key="datasets:file-input"
        />
        {this.state.busy && <p className="dataset-panel-status">{t("Uploading...")}</p>}
        {this.state.error && <p className="maputnik-modal-error">{this.state.error}</p>}
      </section>

      <section className="maputnik-modal-section dataset-panel-section dataset-panel-loaded-section">
        <div className="dataset-panel-section-heading">
          <div>
            <div className="dataset-panel-eyebrow"><MdFolderOpen /> {t("Workspace")}</div>
            <h1>{t("Loaded datasets")}</h1>
          </div>
          {datasets.length > 0 && <span className="dataset-panel-count">{datasets.length}</span>}
        </div>
        {datasets.length === 0 && <p className="dataset-panel-empty">{t("No datasets yet.")}</p>}
        <div className="maputnik-dataset-list" data-wd-key="datasets:list">
          {datasets.map(dataset => {
            const display = getDatasetDisplay(dataset);
            return <article className="maputnik-dataset-item" key={dataset.id} data-wd-key={`datasets:item:${dataset.id}`}>
              <div className="maputnik-dataset-item-header">
                <div className="maputnik-dataset-item-name" title={dataset.name}>{dataset.name}</div>
                <InputButton
                  onClick={() => void this.onRemove(dataset.id)}
                  aria-label={t("Remove dataset")}
                  className="maputnik-button--with-icon maputnik-dataset-item-remove"
                  data-wd-key={`datasets:remove:${dataset.id}`}
                >
                  <MdDelete />
                </InputButton>
              </div>
              <div className="maputnik-dataset-item-meta">
                {display.rowCount} {t("rows")}
              </div>
              <div className="maputnik-dataset-item-columns" aria-label={t("Columns")}>
                {display.columns.map(column => <span key={column}>{column}</span>)}
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>;
  }
}

export const DatasetPanel = withTranslation()(DatasetPanelInternal);
