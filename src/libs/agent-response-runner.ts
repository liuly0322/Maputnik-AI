import {
  createFunctionCallOutputItem,
  streamResponsesApi,
  type AgentInputItem,
  type AgentSettings,
} from "./agent-client";
import type {ChatMessage} from "./agent-conversation";
import {
  executeAgentJavaScript,
  stringifyResult,
  truncateToolOutput,
  type AgentExecutionContext,
} from "./agent-executor";

const MAX_TOOL_ROUNDS = 20;

type AgentResponseRunnerOptions = {
  settings: AgentSettings;
  instructions: string;
  initialInputItems: AgentInputItem[];
  initialMessages: ChatMessage[];
  signal: AbortSignal;
  createExecutionContext(): AgentExecutionContext;
  generateId(): string;
  onMessagesChange(messages: ChatMessage[]): void;
  onInputItemsChange(inputItems: AgentInputItem[], messages: ChatMessage[]): Promise<void>;
};

function extractAssistantText(item: Record<string, any>) {
  if (Array.isArray(item.content)) {
    return item.content
      .map((part: any) => part.text ?? part.output_text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return typeof item.content === "string" ? item.content : stringifyResult(item.content);
}

export async function runAgentResponseLoop(options: AgentResponseRunnerOptions) {
  let inputItems = options.initialInputItems;
  let messages = options.initialMessages;
  let functionCalls: Array<Record<string, any>> = [];

  const commitInputItems = async () => {
    await options.onInputItemsChange(inputItems, messages);
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    functionCalls = [];
    const messageIdsByItemId = new Map<string, string>();
    const completedItemIds = new Set<string>();
    const commitPartialMessages = async () => {
      const partialMessages = Array.from(messageIdsByItemId.entries())
        .filter(([itemId]) => !completedItemIds.has(itemId))
        .map(([, messageId]) => messages.find(message => message.id === messageId))
        .filter((message): message is ChatMessage => !!message?.content)
        .map(message => ({
          type: "message",
          role: "assistant",
          content: [{type: "output_text", text: message.content}],
        }));
      if (partialMessages.length > 0) {
        inputItems = [...inputItems, ...partialMessages];
        await commitInputItems();
      }
    };

    try {
      for await (const event of streamResponsesApi(options.settings, options.instructions, inputItems, options.signal)) {
        const data = event.data;

        if (event.type === "response.output_text.delta" && data.delta) {
          let messageId = messageIdsByItemId.get(data.item_id);
          if (!messageId) {
            messageId = options.generateId();
            messageIdsByItemId.set(data.item_id, messageId);
            messages = [...messages, {id: messageId, role: "assistant", content: ""}];
          }
          messages = messages.map(message => {
            if (message.id !== messageId) return message;
            return {...message, content: message.content + data.delta};
          });
          options.onMessagesChange(messages);
        }
        else if (event.type === "response.output_item.done" && data.item) {
          const item = data.item;
          if (typeof item.id === "string") completedItemIds.add(item.id);
          inputItems = [...inputItems, item];
          if (item.type === "function_call") {
            functionCalls.push(item);
          }
          else if (item.type === "message" && item.role === "assistant") {
            const text = extractAssistantText(item);
            let messageId = messageIdsByItemId.get(item.id);
            if (!messageId && text) {
              messageId = options.generateId();
              messageIdsByItemId.set(item.id, messageId);
              messages = [...messages, {id: messageId, role: "assistant", content: text}];
            }
            else if (messageId) {
              messages = messages.map(message => message.id === messageId ? {...message, content: text} : message);
            }
          }
          await commitInputItems();
        }
      }
    }
    catch (error) {
      if (!options.signal.aborted) throw error;
      await commitPartialMessages();
      return;
    }

    if (options.signal.aborted) {
      await commitPartialMessages();
      return;
    }

    if (functionCalls.length === 0) {
      break;
    }

    for (const functionCall of functionCalls) {
      if (options.signal.aborted) return;
      let code = "";
      try {
        code = JSON.parse(functionCall.arguments ?? "{}").code ?? "";
      }
      catch {
        // Keep the default empty code when tool arguments cannot be parsed.
      }
      let output: string;
      try {
        output = await executeAgentJavaScript(code, options.createExecutionContext());
      }
      catch (error) {
        output = `Error: ${error instanceof Error ? error.stack || error.message : String(error)}`;
      }
      if (options.signal.aborted) return;
      output = truncateToolOutput(output);
      inputItems = [...inputItems, createFunctionCallOutputItem(functionCall.call_id, output)];
      messages = [...messages, {
        id: options.generateId(),
        role: "tool",
        content: output || "(no output)",
        callId: functionCall.call_id,
      }];
      await commitInputItems();
    }
  }

  if (functionCalls.length > 0) {
    messages = [...messages, {
      id: options.generateId(),
      role: "assistant",
      content: `Reached the maximum of ${MAX_TOOL_ROUNDS} tool calls. Send another message to continue.`,
    }];
    options.onMessagesChange(messages);
  }
}
