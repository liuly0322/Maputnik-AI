import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {MdChevronRight, MdCode} from "react-icons/md";
import {useTranslation} from "react-i18next";

import {
  groupAgentConversation,
  extractMessageText,
  extractMessageImages,
  extractToolOutput,
  extractToolCode,
  type AgentConversationTool,
} from "../libs/agent-conversation";
import type {AgentInputItem} from "../libs/agent-client";

type AgentConversationProps = {
  session?: {
    inputItems: AgentInputItem[];
  };
  busy: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

function MessageImages({message}: {message: AgentInputItem}) {
  const images = extractMessageImages(message);
  if (images.length === 0) return null;
  return <div className="agent-console-message-images">
    {images.map((image, index) => {
      return <img className="agent-console-message-image" src={image} alt="" key={`${message.id}-${index}`} />;
    })}
  </div>;
}

function isToolError(message: AgentConversationTool) {
  return !!message.output && /^Error(?:\b|:)/.test(extractToolOutput(message.output).trim());
}

function ToolDetails({tools, groupId}: {tools: AgentConversationTool[]; groupId: string}) {
  const {t} = useTranslation();
  const hasError = tools.some(isToolError);

  return <details
    className={`agent-console-tool-details ${hasError ? "agent-console-tool-details--error" : ""}`}
    data-wd-key={`agent-console:tool-details:${groupId}`}
  >
    <summary data-wd-key="agent-console:tool-details-toggle">
      <MdChevronRight className="agent-console-tool-chevron" aria-hidden="true" />
      <MdCode aria-hidden="true" />
      <span>{t(
        tools.length === 1
          ? "Execution details · {{count}} call"
          : "Execution details · {{count}} calls",
        {count: tools.length}
      )}</span>
    </summary>
    <div className="agent-console-tool-calls">
      {tools.map((tool, index) => {
        const error = isToolError(tool);
        const code = extractToolCode(tool.call);
        return <section
          className={`agent-console-tool-call ${error ? "agent-console-tool-call--error" : ""}`}
          key={tool.id}
          data-wd-key={`agent-console:tool-call:${tool.id}`}
        >
          <header>
            <span>{tool.call?.name ?? t("Tool call")}</span>
            <span>{index + 1}/{tools.length}</span>
          </header>
          {code !== undefined && <div className="agent-console-tool-section">
            <h2>{t("JavaScript")}</h2>
            <pre className="agent-console-tool-code">{code}</pre>
          </div>}
          {!tool.output
            ? <div className="agent-console-tool-pending" data-wd-key="agent-console:tool-pending">
              <span className="agent-console-tool-pending-dot" aria-hidden="true" />
              <span>{t("Running tool...")}</span>
            </div>
            : <div className="agent-console-tool-section">
              <h2>{t("Output")}</h2>
              <pre className="agent-console-tool-output">{extractToolOutput(tool.output)}</pre>
            </div>}
        </section>;
      })}
    </div>
  </details>;
}

export function AgentConversation({session, busy, messagesEndRef}: AgentConversationProps) {
  const {t} = useTranslation();
  const turns = groupAgentConversation(session?.inputItems ?? [], busy);

  return <div className="agent-console-messages" data-wd-key="agent-console:messages">
    <div className="agent-console-message-column">
      {!session && <p>{t("Select or create a session.")}</p>}
      {session?.inputItems.length === 0 && <p>{t("Ask the agent to inspect or modify the live map.")}</p>}
      {turns.map(turn => {
        return <article className="agent-console-turn" key={turn.id} data-wd-key={`agent-console:turn:${turn.id}`}>
          {turn.user && <div className="agent-console-message agent-console-message--user" data-wd-key={`agent-console:message:${turn.id}`}>
            <div className="agent-console-message-role">{t("You")}</div>
            <div className="agent-console-message-bubble">
              <div className="agent-console-message-text">{extractMessageText(turn.user)}</div>
              <MessageImages message={turn.user} />
            </div>
          </div>}
          {turn.items.map((item, itemIndex) => {
            if (item.type === "tools") {
              return <ToolDetails
                tools={item.tools}
                groupId={`${turn.id}-${itemIndex}`}
                key={`tools-${turn.id}-${itemIndex}`}
              />;
            }

            const message = item.message;
            return <div
              className="agent-console-assistant-round"
              key={item.id}
              data-wd-key={`agent-console:assistant-round:${item.id}`}
            >
              <div
                className="agent-console-message agent-console-message--assistant"
                data-wd-key={`agent-console:message:${item.id}`}
              >
                <div className="agent-console-message-role">{t("Agent")}</div>
                <div className="agent-console-message-bubble agent-console-message-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{extractMessageText(message)}</Markdown>
                  <MessageImages message={message} />
                </div>
              </div>
              {item.tools.length > 0 && <ToolDetails
                tools={item.tools}
                groupId={`${turn.id}-${item.id}`}
              />}
            </div>;
          })}
        </article>;
      })}
      {busy && <div className="agent-console-generating" data-wd-key="agent-console:generating">
        <svg className="agent-console-generating-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>{t("Generating reply...")}</span>
      </div>}
      <div ref={messagesEndRef} />
    </div>
  </div>;
}
