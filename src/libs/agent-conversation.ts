import type {AgentInputItem} from "./agent-client";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  callId?: string;
};

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

function extractMessageText(item: AgentInputItem) {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map((part: Record<string, any>) => part.text ?? part.output_text ?? "")
    .filter((text: unknown): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
}

function extractMessageImages(item: AgentInputItem) {
  if (!Array.isArray(item.content)) return [];
  return item.content
    .filter((part: Record<string, any>) => part.type === "input_image" && typeof part.image_url === "string")
    .map((part: Record<string, any>) => part.image_url as string);
}

function extractToolOutput(item: AgentInputItem) {
  if (item.output === undefined || item.output === null || item.output === "") return "(no output)";
  if (typeof item.output === "string") return item.output;
  try {
    return JSON.stringify(item.output, null, 2);
  }
  catch {
    return String(item.output);
  }
}

export function createChatMessages(inputItems: AgentInputItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  inputItems.forEach((item, index) => {
    if (item.type === "message" && (item.role === "user" || item.role === "assistant")) {
      const content = extractMessageText(item);
      if (item.role === "assistant" && !content) return;
      const images = item.role === "user" ? extractMessageImages(item) : [];
      messages.push({
        id: `input-item-${typeof item.id === "string" ? item.id : index}`,
        role: item.role,
        content,
        ...(images.length > 0 ? {images} : {}),
      });
    }
    else if (item.type === "function_call_output") {
      messages.push({
        id: `input-item-${typeof item.call_id === "string" ? item.call_id : index}-output`,
        role: "tool",
        content: extractToolOutput(item),
        callId: typeof item.call_id === "string" ? item.call_id : undefined,
      });
    }
  });

  return messages;
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
  const functionCallsById = new Map(functionCalls
    .filter(toolCall => toolCall.callId)
    .map(toolCall => [toolCall.callId, toolCall] as const));
  const matchedFunctionCalls = new Set<NonNullable<AgentConversationMessage["toolCall"]>>();
  let functionCallIndex = 0;

  const conversationMessages: AgentConversationMessage[] = messages.map(message => {
    if (message.role !== "tool") return message;
    let toolCall = message.callId ? functionCallsById.get(message.callId) : undefined;
    while (!toolCall && functionCallIndex < functionCalls.length) {
      const candidate = functionCalls[functionCallIndex];
      functionCallIndex += 1;
      if (!matchedFunctionCalls.has(candidate)) toolCall = candidate;
    }
    if (toolCall) matchedFunctionCalls.add(toolCall);
    return toolCall ? {...message, toolCall} : message;
  });

  if (includePendingToolCalls) {
    functionCalls.filter(toolCall => !matchedFunctionCalls.has(toolCall)).forEach((toolCall, index) => {
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
