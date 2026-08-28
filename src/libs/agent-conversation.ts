import type {AgentInputItem} from "./agent-client";
import type {ChatMessage} from "./agent-session-store";

export type AgentConversationMessage = ChatMessage & {
  toolCall?: {
    name: string;
    callId?: string;
    code?: string;
  };
  toolPending?: boolean;
};

export type AgentConversationItem =
  | {type: "assistant"; message: AgentConversationMessage; tools: AgentConversationMessage[]}
  | {type: "tools"; messages: AgentConversationMessage[]};

export type AgentConversationTurn = {
  id: string;
  user?: AgentConversationMessage;
  items: AgentConversationItem[];
};

function createTurn(user?: AgentConversationMessage): AgentConversationTurn {
  return {
    id: user?.id ?? "conversation-start",
    user,
    items: [],
  };
}

function appendResponseMessage(turn: AgentConversationTurn, message: AgentConversationMessage) {
  if (message.role === "assistant") {
    turn.items.push({type: "assistant", message, tools: []});
    return;
  }

  const lastItem = turn.items[turn.items.length - 1];
  if (lastItem?.type === "assistant") {
    lastItem.tools.push(message);
  }
  else if (lastItem?.type === "tools") {
    lastItem.messages.push(message);
  }
  else {
    turn.items.push({type: "tools", messages: [message]});
  }
}

function extractToolCall(item: AgentInputItem): AgentConversationMessage["toolCall"] | undefined {
  if (item.type !== "function_call") return undefined;

  let code: string | undefined;
  try {
    const argumentsValue = typeof item.arguments === "string"
      ? JSON.parse(item.arguments)
      : item.arguments;
    if (typeof argumentsValue?.code === "string") code = argumentsValue.code;
  }
  catch {
    // The output can still be rendered when historical arguments are invalid.
  }

  return {
    name: typeof item.name === "string" ? item.name : "run_javascript",
    callId: typeof item.call_id === "string" ? item.call_id : undefined,
    code,
  };
}

function attachToolCalls(
  messages: ChatMessage[],
  inputItems: AgentInputItem[],
  includePendingToolCalls: boolean
): AgentConversationMessage[] {
  const functionCalls = inputItems
    .map(extractToolCall)
    .filter((toolCall): toolCall is NonNullable<AgentConversationMessage["toolCall"]> => !!toolCall);
  let functionCallIndex = 0;

  const conversationMessages: AgentConversationMessage[] = messages.map(message => {
    if (message.role !== "tool") return message;
    const toolCall = functionCalls[functionCallIndex];
    functionCallIndex += 1;
    return toolCall ? {...message, toolCall} : message;
  });

  if (includePendingToolCalls) {
    functionCalls.slice(functionCallIndex).forEach((toolCall, index) => {
      conversationMessages.push({
        id: `pending-tool-${toolCall.callId ?? index}`,
        role: "tool",
        content: "",
        toolCall,
        toolPending: true,
      });
    });
  }

  return conversationMessages;
}

export function groupAgentConversation(
  messages: ChatMessage[],
  inputItems: AgentInputItem[] = [],
  includePendingToolCalls = false
): AgentConversationTurn[] {
  const turns: AgentConversationTurn[] = [];
  let currentTurn: AgentConversationTurn | undefined;

  for (const message of attachToolCalls(messages, inputItems, includePendingToolCalls)) {
    if (message.role === "user") {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = createTurn(message);
      continue;
    }

    if (!currentTurn) currentTurn = createTurn();
    appendResponseMessage(currentTurn, message);
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}
