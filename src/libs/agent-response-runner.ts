import {
  createFunctionCallOutputItem,
  streamResponsesApi,
  type AgentInputItem,
  type AgentSettings,
} from "./agent-client";
import {
  executeAgentJavaScript,
  truncateToolOutput,
  type AgentExecutionContext,
} from "./agent-executor";

export const MAX_TOOL_ROUNDS = 20;

type AgentResponseRunnerOptions = {
  settings: AgentSettings;
  instructions: string;
  initialInputItems: AgentInputItem[];
  signal: AbortSignal;
  createExecutionContext(): AgentExecutionContext;
  onItemsChange(inputItems: AgentInputItem[], options: {persist: boolean}): Promise<void>;
};

export async function runAgentResponseLoop(options: AgentResponseRunnerOptions) {
  let inputItems = options.initialInputItems;
  let functionCalls: Array<Record<string, any>> = [];
  const publish = (persist: boolean) => options.onItemsChange(inputItems, {persist});

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    functionCalls = [];
    const itemIndexes = new Map<string, number>();
    let hasPartialTextToPersist = false;

    try {
      for await (const event of streamResponsesApi(options.settings, options.instructions, inputItems, options.signal)) {
        const data = event.data;
        if (event.type === "response.output_text.delta" && data.delta) {
          let index = itemIndexes.get(data.item_id);
          if (index === undefined) {
            index = inputItems.length;
            itemIndexes.set(data.item_id, index);
            // Partial messages intentionally have no server ID or completion status.
            inputItems = [...inputItems, {type: "message", role: "assistant", content: []}];
          }
          const item = inputItems[index];
          const content = [...item.content];
          const contentIndex = data.content_index ?? 0;
          content[contentIndex] = {type: "output_text", text: (content[contentIndex]?.text ?? "") + data.delta};
          inputItems = inputItems.map((candidate, position) => position === index ? {...item, content} : candidate);
          hasPartialTextToPersist = true;
          await publish(false);
        }
        else if (event.type === "response.output_item.done" && data.item) {
          const item = data.item;
          const index = itemIndexes.get(item.id);
          if (index === undefined) {
            itemIndexes.set(item.id, inputItems.length);
            inputItems = [...inputItems, item];
          }
          else {
            inputItems = inputItems.map((candidate, position) => position === index ? item : candidate);
          }
          if (item.type === "function_call") functionCalls.push(item);
          await publish(true);
          hasPartialTextToPersist = false;
        }
      }
    }
    catch (error) {
      if (!options.signal.aborted) throw error;
      return;
    }
    finally {
      if (hasPartialTextToPersist) {
        // Compact sparse content parts in interrupted messages before persistence/replay.
        inputItems = inputItems.map(item => item.type === "message" && Array.isArray(item.content)
          ? {...item, content: item.content.filter(Boolean)} : item);
        await publish(true);
      }
    }

    if (options.signal.aborted) return;

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
      await publish(true);
    }
  }

  return functionCalls.length > 0 ? "max-tool-rounds" : undefined;
}
