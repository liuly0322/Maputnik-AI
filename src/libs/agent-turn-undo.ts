import cloneDeep from "lodash.clonedeep";
import type {StyleSpecification} from "maplibre-gl";

import type {AgentInputItem} from "./agent-client";
import type {AgentSession} from "./agent-session-store";

export type AgentTurnUndoStyle = StyleSpecification;

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
  const pendingImages = item.content
    .filter((part: Record<string, any>) => part.type === "input_image" && typeof part.image_url === "string")
    .map((part: Record<string, any>) => part.image_url as string);

  return {input, pendingImages};
}

export function createAgentTurnUndoStyle(style: StyleSpecification): AgentTurnUndoStyle {
  return cloneDeep(style);
}

export function undoLatestAgentTurn(
  session: AgentSession,
  styleBefore: AgentTurnUndoStyle,
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
