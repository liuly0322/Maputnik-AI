import {describe, expect, it} from "vitest";
import type {StyleSpecification} from "maplibre-gl";

import type {AgentSession} from "./agent-session-store";
import {createAgentTurnUndoStyle, undoLatestAgentTurn} from "./agent-turn-undo";

function style(name: string): StyleSpecification {
  return {
    version: 8,
    name,
    sources: {},
    layers: [],
  };
}

function session(inputItems: AgentSession["inputItems"]): AgentSession {
  return {
    id: "session-1",
    title: "First request",
    inputItems,
    createdAt: 1,
    updatedAt: 2,
    styleCheckpoint: style("after"),
  };
}

const firstTurn = [
  {type: "message", role: "user", content: [{type: "input_text", text: "First request"}]},
  {type: "message", role: "assistant", content: [{type: "output_text", text: "First answer"}]},
];

describe("agent turn undo", () => {
  it("keeps an independent style snapshot", () => {
    const currentStyle = style("before");
    const snapshot = createAgentTurnUndoStyle(currentStyle);

    currentStyle.name = "changed";
    expect(snapshot.name).toBe("before");
  });

  it("removes every item from the latest user turn across multiple tool rounds", () => {
    const inputItems = [
      ...firstTurn,
      {
        type: "message",
        role: "user",
        content: [
          {type: "input_text", text: "Second request"},
          {type: "input_image", image_url: "data:image/png;base64,image"},
        ],
      },
      {type: "function_call", call_id: "call-1", arguments: "{}"},
      {type: "function_call_output", call_id: "call-1", output: "one"},
      {type: "function_call", call_id: "call-2", arguments: "{}"},
      {type: "function_call_output", call_id: "call-2", output: "two"},
      {type: "message", role: "assistant", content: [{type: "output_text", text: "Done"}]},
    ];

    const result = undoLatestAgentTurn(session(inputItems), style("before second"), 10);

    expect(result).not.toBeNull();
    expect(result!.session.inputItems).toEqual(firstTurn);
    expect(result!.session.styleCheckpoint).toEqual(style("before second"));
    expect(result!.session.updatedAt).toBe(10);
    expect(result!.input).toBe("Second request");
    expect(result!.pendingImages).toEqual(["data:image/png;base64,image"]);
  });

  it("keeps the session but clears its checkpoint and title after undoing the first turn", () => {
    const result = undoLatestAgentTurn(session(firstTurn), style("before first"), 10);

    expect(result!.session).toMatchObject({
      title: "New session",
      inputItems: [],
      styleCheckpoint: null,
      updatedAt: 10,
    });
  });

  it("returns null when the session has no user turn", () => {
    expect(undoLatestAgentTurn(session([]), style("before"))).toBeNull();
  });
});
