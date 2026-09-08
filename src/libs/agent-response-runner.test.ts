import {describe, expect, it, vi} from "vitest";
import type * as AgentClient from "./agent-client";
import {streamResponsesApi, type AgentInputItem, type AgentStreamEvent} from "./agent-client";
import {runAgentResponseLoop} from "./agent-response-runner";

vi.mock("./agent-client", async importOriginal => ({
  ...await importOriginal<typeof AgentClient>(),
  streamResponsesApi: vi.fn(),
}));

const delta = (text: string, contentIndex = 0) => ({
  type: "response.output_text.delta", data: {item_id: "msg-1", content_index: contentIndex, delta: text},
});

async function run(events: AgentStreamEvent[], abort = false) {
  const controller = new AbortController();
  vi.mocked(streamResponsesApi).mockImplementation(async function* () {
    yield* events;
    if (abort) {
      controller.abort();
      throw new Error("aborted");
    }
  });
  const updates: {items: AgentInputItem[]; persist: boolean}[] = [];
  await runAgentResponseLoop({
    settings: {apiKey: "test", endpoint: "test", model: "test"},
    instructions: "test",
    initialInputItems: [],
    signal: controller.signal,
    createExecutionContext: () => {throw new Error("Unexpected tool execution");},
    onItemsChange: async (items, {persist}) => {updates.push({items, persist});},
  });
  return updates;
}

describe("runAgentResponseLoop", () => {
  it("replaces streamed text with the complete protocol item without duplication", async () => {
    const complete = {id: "msg-1", type: "message", role: "assistant", content: [{type: "output_text", text: "Hello"}], status: "completed"};
    const updates = await run([delta("Hel"), delta("lo"), {
      type: "response.output_item.done", data: {item: complete},
    }]);
    expect(updates[0].items[0].content[0].text).toBe("Hel");
    expect(updates[updates.length - 1]?.items).toEqual([complete]);
    expect(updates[updates.length - 1]?.persist).toBe(true);
  });

  it("persists interrupted content parts without a server ID or completion status", async () => {
    const updates = await run([delta("First"), delta("Second", 1), delta(" part", 1)], true);
    expect(updates[updates.length - 1]).toEqual({persist: true, items: [{
      type: "message", role: "assistant", content: [
        {type: "output_text", text: "First"},
        {type: "output_text", text: "Second part"},
      ],
    }]});
  });
});
