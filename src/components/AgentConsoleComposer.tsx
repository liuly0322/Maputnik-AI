import React from "react";
import type {TFunction} from "i18next";
import {MdImage, MdSend, MdStop} from "react-icons/md";

type AgentConsoleComposerProps = {
  t: TFunction;
  input: string;
  pendingImages: string[];
  busy: boolean;
  sessionsReady: boolean;
  onAddFiles(files: File[]): void;
  onRemovePendingImage(index: number): void;
  onInputChange(value: string): void;
  onStop(): void;
  onSend(): void;
};

export function AgentConsoleComposer(props: AgentConsoleComposerProps) {
  const {t} = props;
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  return <div className="agent-console-composer">
    <input
      ref={imageInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{display: "none"}}
      onChange={event => {
        props.onAddFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
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
      onChange={event => props.onInputChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          props.onSend();
        }
      }}
      onPaste={event => {
        const files = Array.from(event.clipboardData.items)
          .filter(item => item.kind === "file" && item.type.startsWith("image/"))
          .map(item => item.getAsFile())
          .filter((file): file is File => file !== null);
        props.onAddFiles(files);
      }}
      placeholder={t("Describe what you want to inspect or change...")}
      disabled={props.busy || !props.sessionsReady}
      data-wd-key="agent-console:input"
    />
    <div className="agent-console-toolbar">
      <button className="maputnik-button maputnik-button--with-icon" onClick={() => imageInputRef.current?.click()} data-wd-key="agent-console:add-image">
        <MdImage />
        {t("Add image")}
      </button>
      {props.busy
        ? <button className="maputnik-button maputnik-button--with-icon agent-console-stop" onClick={props.onStop} data-wd-key="agent-console:stop" aria-label={t("Stop generating")}>
          <MdStop />
          {t("Stop generating")}
        </button>
        : <button className="maputnik-button maputnik-button--with-icon" onClick={props.onSend} disabled={!props.sessionsReady} data-wd-key="agent-console:send">
          <MdSend />
          {t("Send")}
        </button>}
    </div>
  </div>;
}
