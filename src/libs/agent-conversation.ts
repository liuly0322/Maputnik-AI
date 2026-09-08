import type {AgentInputItem} from "./agent-client";

export type AgentConversationTool = {
  id: string;
  call?: AgentInputItem;
  output?: AgentInputItem;
};

export type AgentConversationItem =
  | {type: "assistant"; id: string; message: AgentInputItem; tools: AgentConversationTool[]}
  | {type: "tools"; tools: AgentConversationTool[]};

export type AgentConversationTurn = {
  id: string;
  user?: AgentInputItem;
  items: AgentConversationItem[];
};

export function extractMessageText(item: AgentInputItem) {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map((part: Record<string, any>) => part.text ?? part.output_text ?? "")
    .filter((text: unknown): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
}

export function extractMessageImages(item: AgentInputItem) {
  if (!Array.isArray(item.content)) return [];
  return item.content
    .filter((part: Record<string, any>) => part.type === "input_image" && typeof part.image_url === "string")
    .map((part: Record<string, any>) => part.image_url as string);
}

export function extractToolOutput(item: AgentInputItem) {
  if (item.output === undefined || item.output === null || item.output === "") return "(no output)";
  if (typeof item.output === "string") return item.output;
  try {
    return JSON.stringify(item.output, null, 2);
  }
  catch {
    return String(item.output);
  }
}

export function extractToolCode(call?: AgentInputItem): string | undefined {
  try {
    const args = typeof call?.arguments === "string" ? JSON.parse(call.arguments) : call?.arguments;
    return typeof args?.code === "string" ? args.code : undefined;
  }
  catch {
    return undefined;
  }
}

export function groupAgentConversation(inputItems: AgentInputItem[], busy = false): AgentConversationTurn[] {
  const turns: AgentConversationTurn[] = [];
  const outputs = new Map(inputItems
    .filter(item => item.type === "function_call_output" && typeof item.call_id === "string")
    .map(item => [item.call_id, item]));
  const callIds = new Set(inputItems.filter(item => item.type === "function_call").map(item => item.call_id));
  let turn: AgentConversationTurn | undefined;

  inputItems.forEach((item, index) => {
    // Array positions remain stable while streaming items are replaced by completed output.
    const id = `input-item-${index}`;
    if (item.type === "message" && item.role === "user") {
      turn = {id, user: item, items: []};
      turns.push(turn);
      return;
    }
    const assistant = item.type === "message" && item.role === "assistant" && extractMessageText(item);
    const output = item.type === "function_call" ? outputs.get(item.call_id) : undefined;
    const tool = item.type === "function_call" && (output || busy);
    const orphanOutput = item.type === "function_call_output" && !callIds.has(item.call_id);
    if (!assistant && !tool && !orphanOutput) return;
    if (!turn) {
      turn = {id: "conversation-start", items: []};
      turns.push(turn);
    }
    if (assistant) {
      turn.items.push({type: "assistant", id, message: item, tools: []});
      return;
    }
    const entry: AgentConversationTool = tool ? {id, call: item, output} : {id, output: item};
    const last = turn.items[turn.items.length - 1];
    if (last) last.tools.push(entry);
    else turn.items.push({type: "tools", tools: [entry]});
  });
  return turns;
}
