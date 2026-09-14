import React from "react";
import {type WithTranslation, withTranslation} from "react-i18next";
import type {Map} from "maplibre-gl";

import {Modal} from "./Modal";
import {AgentExportPanel} from "../AgentExportPanel";

type ModalExportImageInternalProps = {
  isOpen: boolean
  onOpenToggle(): void
  map: Map | null
  renderer: "mlgljs" | "ol"
  styleName: string
} & WithTranslation;

/** PNG export of the live map, as a header modal alongside the style export. */
class ModalExportImageInternal extends React.Component<ModalExportImageInternalProps> {
  render() {
    const {t} = this.props;

    return <Modal
      title={t("Export image")}
      isOpen={this.props.isOpen}
      onOpenToggle={this.props.onOpenToggle}
      data-wd-key="modal:export-image"
    >
      <AgentExportPanel
        map={this.props.map}
        renderer={this.props.renderer}
        styleName={this.props.styleName}
      />
    </Modal>;
  }
}

export const ModalExportImage = withTranslation()(ModalExportImageInternal);
