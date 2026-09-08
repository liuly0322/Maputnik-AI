import cloneDeep from "lodash.clonedeep";
import type {StyleSpecification} from "maplibre-gl";

import type {AgentInputItem} from "./agent-client";
import {extractMessageImages} from "./agent-conversation";
import type {AgentSession} from "./agent-session-store";

export type AgentTurnUndoResult = {
  session: AgentSession;
  input: string;
  pendingImages: string[];
};

function isUserMessage(item: AgentInputItem) {
  return item.type === "message" && item.role === "user";
}

function extractComposerContent(item: AgentInputItem) {
  if (typeof item.content === "string") {
    return {input: item.content, pendingImages: []};
  }

  if (!Array.isArray(item.content)) {
    return {input: "", pendingImages: []};
  }

  const input = item.content
    .map((part: Record<string, any>) => part.type === "input_text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
  return {input, pendingImages: extractMessageImages(item)};
}

export function undoLatestAgentTurn(
  session: AgentSession,
  styleBefore: StyleSpecification,
  updatedAt = Date.now()
): AgentTurnUndoResult | null {
  let userItemIndex = -1;
  for (let index = session.inputItems.length - 1; index >= 0; index -= 1) {
    if (isUserMessage(session.inputItems[index])) {
      userItemIndex = index;
      break;
    }
  }
  if (userItemIndex < 0) return null;

  const composer = extractComposerContent(session.inputItems[userItemIndex]);
  const inputItems = session.inputItems.slice(0, userItemIndex);
  const isEmpty = inputItems.length === 0;

  return {
    session: {
      ...session,
      title: isEmpty ? "New session" : session.title,
      inputItems,
      updatedAt,
      styleCheckpoint: isEmpty ? null : cloneDeep(styleBefore),
    },
    ...composer,
  };
}
