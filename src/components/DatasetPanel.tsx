import React from "react";
import {MdDelete, MdFileUpload} from "react-icons/md";
import {type WithTranslation, withTranslation} from "react-i18next";

import {InputButton} from "./InputButton";
import type {DatasetStore} from "../libs/dataset-store";

type DatasetPanelInternalProps = {
  store: DatasetStore;
} & WithTranslation;

type DatasetPanelInternalState = {
  error?: string;
  busy: boolean;
};

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
      // The store is external mutable state, so the list it feeds needs an
      // explicit re-render rather than a state update.
      this.forceUpdate();
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
      this.forceUpdate();
    }
    catch (error) {
      this.setState({error: error instanceof Error ? error.message : String(error)});
    }
  };

  render() {
    const {t} = this.props;
    const datasets = this.props.store.getAll();

    return <div className="dataset-panel" data-wd-key="agent-workspace:data">
      <section className="dataset-panel-section">
        <div className="dataset-panel-section-header">
          <p className="dataset-panel-description">{t("Upload a CSV file. The agent can inspect its columns and rows without assuming which columns are coordinates.")}</p>
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

      <section className="dataset-panel-section">
        <div className="dataset-panel-section-heading">
          <span className="dataset-panel-section-label">{t("Loaded datasets")}</span>
          {datasets.length > 0 && <span className="dataset-panel-count">{datasets.length}</span>}
        </div>
        {datasets.length === 0 && <p className="dataset-panel-empty">{t("No datasets yet.")}</p>}
        <div className="maputnik-dataset-list" data-wd-key="datasets:list">
          {datasets.map(dataset => {
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
                {dataset.data.rows.length} {t("rows")}
              </div>
              <div className="maputnik-dataset-item-columns" aria-label={t("Columns")}>
                {dataset.data.columns.map(column => <span key={column}>{column}</span>)}
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>;
  }
}

export const DatasetPanel = withTranslation()(DatasetPanelInternal);
