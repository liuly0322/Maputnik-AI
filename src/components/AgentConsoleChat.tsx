import React from "react";
import type {TFunction} from "i18next";
import type {StyleSpecification} from "maplibre-gl";
import {MdCompareArrows, MdRestore, MdUndo} from "react-icons/md";

import type {AgentSession} from "../libs/agent-session-store";
import {AgentConversation} from "./AgentConversation";
import {AgentSessionPicker} from "./AgentSessionPicker";
import {AgentStyleChangePreview} from "./AgentStyleChangePreview";

type AgentConsoleChatProps = {
  t: TFunction;
  session?: AgentSession;
  sessions: AgentSession[];
  busy: boolean;
  canUndo: boolean;
  sessionsReady: boolean;
  onNewSession(): void;
  onSelectSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  previewStyleBefore?: StyleSpecification;
  previewAvailable: boolean;
  stylePreviewOpen: boolean;
  /** True when the live map no longer matches this session's saved style. */
  styleDrifted: boolean;
  onToggleStylePreview(): void;
  onUndoTurn(): void;
  onLoadStyle(): void;
  onCloseStylePreview(): void;
  composer: React.ReactNode;
};

export function AgentConsoleChat(props: AgentConsoleChatProps) {
  const {t} = props;

  // These act on the turn that just finished. While the next one generates
  // they are already known to be invalid, so the row goes.
  const showTurnActions = !props.busy && (props.previewAvailable || props.canUndo);

  return <section className="agent-console-chat-card" data-wd-key="agent-console:chat-card">
    <header className="agent-console-chat-header">
      <h1>{t("Session")}</h1>
      <AgentSessionPicker
        t={t}
        sessions={props.sessions}
        sessionsReady={props.sessionsReady}
        activeSessionId={props.session?.id ?? null}
        onNewSession={props.onNewSession}
        onSelectSession={props.onSelectSession}
        onDeleteSession={props.onDeleteSession}
      />
    </header>
    <div className="agent-console-chat-body">
      <AgentConversation
        key={props.session?.id}
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
    {props.styleDrifted && <div className="agent-console-style-drift" data-wd-key="agent-console:style-drift">
      <span>{t("This session saved a different style than the map is showing.")}</span>
      <button
        className="maputnik-button maputnik-button--with-icon agent-console-turn-action"
        onClick={props.onLoadStyle}
        data-wd-key="agent-console:restore-style"
      >
        <MdRestore />
        {t("Restore")}
      </button>
    </div>}
    {showTurnActions && <div className="agent-console-turn-actions">
      <button
        className="maputnik-button maputnik-button--with-icon agent-console-turn-action"
        onClick={props.onToggleStylePreview}
        title={t("Preview style changes from the latest turn")}
        aria-expanded={props.stylePreviewOpen}
        aria-controls="agent-style-change-preview"
        data-wd-key="agent-console:preview-style-changes"
      >
        <MdCompareArrows />
        {t("Preview changes")}
      </button>
      <button
        className="maputnik-button maputnik-button--with-icon agent-console-turn-action"
        onClick={props.onUndoTurn}
        title={t("Undo the latest agent turn and restore its text and images to the composer")}
        data-wd-key="agent-console:undo-turn"
      >
        <MdUndo />
        {t("Undo")}
      </button>
    </div>}
    {props.composer}
  </section>;
}
