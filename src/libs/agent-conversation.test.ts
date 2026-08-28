import {describe, expect, it} from "vitest";

import {groupAgentConversation} from "./agent-conversation";
import type {ChatMessage} from "./agent-session-store";

function message(id: string, role: ChatMessage["role"], content = id): ChatMessage {
  return {id, role, content};
}

describe("groupAgentConversation", () => {
  it("groups messages into user turns", () => {
    const turns = groupAgentConversation([
      message("user-1", "user"),
      message("assistant-1", "assistant"),
      message("user-2", "user"),
      message("assistant-2", "assistant"),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].user?.id).toBe("user-1");
    expect(turns[0].items).toEqual([{
      type: "assistant",
      message: message("assistant-1", "assistant"),
      tools: [],
    }]);
    expect(turns[1].user?.id).toBe("user-2");
  });

  it("uses assistant text as the boundary for tool-call groups", () => {
    const firstTool = message("tool-1", "tool");
    const secondTool = message("tool-2", "tool");
    const turns = groupAgentConversation([
      message("user", "user"),
      message("preface", "assistant"),
      firstTool,
      message("progress", "assistant"),
      secondTool,
      message("answer", "assistant"),
    ]);

    expect(turns[0].items).toEqual([
      {type: "assistant", message: message("preface", "assistant"), tools: [firstTool]},
      {type: "assistant", message: message("progress", "assistant"), tools: [secondTool]},
      {type: "assistant", message: message("answer", "assistant"), tools: []},
    ]);
  });

  it("groups consecutive tools under the preceding assistant text", () => {
    const firstTool = message("tool-1", "tool");
    const secondTool = message("tool-2", "tool");
    const turns = groupAgentConversation([
      message("assistant", "assistant"),
      firstTool,
      secondTool,
    ]);

    expect(turns[0].items).toEqual([{
      type: "assistant",
      message: message("assistant", "assistant"),
      tools: [firstTool, secondTool],
    }]);
  });

  it("derives tool code from input items without changing stored messages", () => {
    const toolOutput = message("tool", "tool", "42");
    const messages = [message("user", "user"), toolOutput];
    const turns = groupAgentConversation(messages, [{
      type: "function_call",
      name: "run_javascript",
      call_id: "call-1",
      arguments: JSON.stringify({code: "return 6 * 7;"}),
    }]);

    expect(turns[0].items[0]).toEqual({
      type: "tools",
      messages: [{
        ...toolOutput,
        toolCall: {
          name: "run_javascript",
          callId: "call-1",
          code: "return 6 * 7;",
        },
      }],
    });
    expect(messages[1]).toBe(toolOutput);
    expect(messages[1]).not.toHaveProperty("toolCall");
  });

  it("keeps tool output usable when stored arguments are invalid or absent", () => {
    const invalid = groupAgentConversation([message("tool", "tool", "result")], [{
      type: "function_call",
      name: "run_javascript",
      call_id: "call-invalid",
      arguments: "{invalid",
    }]);
    const absent = groupAgentConversation([message("tool", "tool", "old result")]);

    expect(invalid[0].items[0]).toEqual({
      type: "tools",
      messages: [{
        id: "tool",
        role: "tool",
        content: "result",
        toolCall: {
          name: "run_javascript",
          callId: "call-invalid",
          code: undefined,
        },
      }],
    });
    expect(absent[0].items[0]).toEqual({
      type: "tools",
      messages: [message("tool", "tool", "old result")],
    });
  });

  it("shows an unmatched in-flight function call even before output exists", () => {
    const messages = [message("user", "user")];
    const turns = groupAgentConversation(messages, [{
      type: "function_call",
      name: "run_javascript",
      call_id: "call-pending",
      arguments: JSON.stringify({code: "return 42;"}),
    }], true);

    expect(turns[0].items).toEqual([{
      type: "tools",
      messages: [{
        id: "pending-tool-call-pending",
        role: "tool",
        content: "",
        toolCall: {
          name: "run_javascript",
          callId: "call-pending",
          code: "return 42;",
        },
        toolPending: true,
      }],
    }]);
    expect(messages).toEqual([message("user", "user")]);
  });
});
