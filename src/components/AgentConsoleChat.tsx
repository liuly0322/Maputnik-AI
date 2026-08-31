import React from "react";
import type {TFunction} from "i18next";
import type {StyleSpecification} from "maplibre-gl";
import {MdCompareArrows, MdRestore, MdUndo} from "react-icons/md";

import type {AgentConsoleSession} from "../libs/agent-conversation";
import {AgentConversation} from "./AgentConversation";
import {AgentStyleChangePreview} from "./AgentStyleChangePreview";

type AgentConsoleChatProps = {
  t: TFunction;
  session?: AgentConsoleSession;
  busy: boolean;
  canUndo: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  previewStyleBefore?: StyleSpecification;
  previewAvailable: boolean;
  stylePreviewOpen: boolean;
  onToggleStylePreview(): void;
  onUndoTurn(): void;
  onLoadStyle(): void;
  onCloseStylePreview(): void;
  composer: React.ReactNode;
};

export function AgentConsoleChat(props: AgentConsoleChatProps) {
  const {t} = props;

  return <section className="agent-console-chat-card" data-wd-key="agent-console:chat-card">
    <header className="agent-console-chat-header">
      <h1>{t("Conversation")}</h1>
      <div className="agent-console-chat-actions">
        <button
          className="maputnik-button agent-console-turn-action"
          onClick={props.onToggleStylePreview}
          disabled={!props.previewAvailable}
          title={t("Preview style changes from the latest turn")}
          aria-expanded={props.stylePreviewOpen && props.previewAvailable}
          aria-controls="agent-style-change-preview"
          data-wd-key="agent-console:preview-style-changes"
        >
          <MdCompareArrows />
          {t("Preview changes")}
        </button>
        <button
          className="maputnik-button agent-console-turn-action"
          onClick={props.onUndoTurn}
          disabled={props.busy || !props.canUndo}
          title={t("Undo the latest agent turn and restore its text and images to the composer")}
          data-wd-key="agent-console:undo-turn"
        >
          <MdUndo />
          {t("Undo")}
        </button>
        {props.session?.styleCheckpoint && <button
          className="maputnik-button agent-console-turn-action"
          onClick={props.onLoadStyle}
          disabled={props.busy}
          title={t("Load the most recently saved style for this conversation")}
          data-wd-key="agent-console:load-style"
        >
          <MdRestore />
          {t("Load")}
        </button>}
      </div>
    </header>
    <div className="agent-console-chat-body">
      <AgentConversation
        session={props.session}
        busy={props.busy}
        messagesEndRef={props.messagesEndRef}
      />
      {props.stylePreviewOpen && props.previewAvailable && props.previewStyleBefore && props.session?.styleCheckpoint && <AgentStyleChangePreview
        before={props.previewStyleBefore}
        after={props.session.styleCheckpoint}
        onClose={props.onCloseStylePreview}
      />}
    </div>
    {props.composer}
  </section>;
}
