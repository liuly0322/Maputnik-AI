import {describe, expect, it} from "vitest";
import {extractMessageImages, extractMessageText, groupAgentConversation} from "./agent-conversation";

const message = (role: string, text: string) => ({type: "message", role, content: [{type: "output_text", text}]});
const call = (id: string) => ({type: "function_call", call_id: id, name: "run_javascript", arguments: "{}"});
const output = (id: string) => ({type: "function_call_output", call_id: id, output: "42"});

describe("groupAgentConversation", () => {
  it("keeps original user items including images", () => {
    const user = {type: "message", role: "user", content: [
      {type: "input_text", text: "Inspect this"},
      {type: "input_image", image_url: "data:image/png;base64,image"},
    ]};
    const turns = groupAgentConversation([user]);
    expect(turns[0].user).toBe(user);
    expect(extractMessageText(user)).toBe("Inspect this");
    expect(extractMessageImages(user)).toEqual(["data:image/png;base64,image"]);
  });

  it("groups user turns and assistant rounds without copying protocol items", () => {
    const user = message("user", "question");
    const assistant = message("assistant", "working");
    const first = call("first");
    const second = call("second");
    const firstOutput = output("first");
    const secondOutput = output("second");
    const progress = message("assistant", "progress");
    const turns = groupAgentConversation([
      user, assistant, first, second, secondOutput, firstOutput, progress, message("user", "next"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].items).toEqual([
      {type: "assistant", id: "input-item-1", message: assistant, tools: [
        {id: "input-item-2", call: first, output: firstOutput},
        {id: "input-item-3", call: second, output: secondOutput},
      ]},
      {type: "assistant", id: "input-item-6", message: progress, tools: []},
    ]);
    expect(turns[0].items[0].tools[0].call).toBe(first);
    expect(turns[0].items[0].tools[0].output).toBe(firstOutput);
  });

  it("keeps pending tools in their original turn", () => {
    const pending = call("pending");
    const items = [message("user", "first"), pending, message("user", "second")];
    expect(groupAgentConversation(items, true)[0].items).toEqual([
      {type: "tools", tools: [{id: "input-item-1", call: pending, output: undefined}]},
    ]);
    expect(groupAgentConversation(items)[0].items).toEqual([]);
  });

  it("preserves orphan outputs and ignores non-display items", () => {
    const orphan = output("orphan");
    expect(groupAgentConversation([{type: "reasoning", encrypted_content: "opaque"}, orphan])[0].items)
      .toEqual([{type: "tools", tools: [{id: "input-item-1", output: orphan}]}]);
  });
});
