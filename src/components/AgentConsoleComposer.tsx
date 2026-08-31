import React from "react";
import type {TFunction} from "i18next";
import {MdImage, MdSend, MdStop} from "react-icons/md";

type AgentConsoleComposerProps = {
  t: TFunction;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  input: string;
  pendingImages: string[];
  busy: boolean;
  sessionsReady: boolean;
  onImageChange(event: React.ChangeEvent<HTMLInputElement>): void;
  onRemovePendingImage(index: number): void;
  onInputChange(event: React.ChangeEvent<HTMLTextAreaElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onAddImage(): void;
  onStop(): void;
  onSend(): void;
};

export function AgentConsoleComposer(props: AgentConsoleComposerProps) {
  const {t} = props;

  return <div className="agent-console-composer">
    <input
      ref={props.imageInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{display: "none"}}
      onChange={props.onImageChange}
      data-wd-key="agent-console:image-input"
    />
    {props.pendingImages.length > 0 && <div className="agent-console-pending-images">
      {props.pendingImages.map((image, index) => <div className="agent-console-pending-image" key={`${image}-${index}`}>
        <img src={image} alt="" />
        <button onClick={() => props.onRemovePendingImage(index)} aria-label={t("Remove image")}>
          ×
        </button>
      </div>)}
    </div>}
    <textarea
      value={props.input}
      onChange={props.onInputChange}
      onKeyDown={props.onKeyDown}
      placeholder={t("Describe what you want to inspect or change...")}
      disabled={props.busy || !props.sessionsReady}
      data-wd-key="agent-console:input"
    />
    <div className="agent-console-toolbar">
      <button className="maputnik-button" onClick={props.onAddImage} data-wd-key="agent-console:add-image">
        <MdImage />
        {t("Add image")}
      </button>
      {props.busy
        ? <button className="maputnik-button agent-console-stop" onClick={props.onStop} data-wd-key="agent-console:stop" aria-label={t("Stop generating")}>
          <MdStop />
          {t("Stop generating")}
        </button>
        : <button className="maputnik-button" onClick={props.onSend} disabled={!props.sessionsReady} data-wd-key="agent-console:send">
          <MdSend />
          {t("Send")}
        </button>}
    </div>
  </div>;
}
