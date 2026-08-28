import {describe, expect, it} from "vitest";

import {
  MAX_TOOL_OUTPUT_UTF8_BYTES,
  truncateToolOutput,
} from "./agent-executor";

const utf8Encoder = new TextEncoder();

describe("truncateToolOutput", () => {
  it("returns output at the byte limit unchanged", () => {
    const output = "x".repeat(MAX_TOOL_OUTPUT_UTF8_BYTES);

    expect(truncateToolOutput(output)).toBe(output);
  });

  it("preserves the beginning and end and reports truncation", () => {
    const output = "start\n" + "x".repeat(120_000) + "\nend";

    const truncated = truncateToolOutput(output);

    expect(utf8Encoder.encode(truncated).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_UTF8_BYTES);
    expect(truncated).toMatch(/^start\n/);
    expect(truncated).toMatch(/\nend$/);
    expect(truncated).toContain(
      `[Tool output truncated: original UTF-8 size ${utf8Encoder.encode(output).length} bytes;`
    );
  });

  it("does not split multi-byte UTF-8 characters", () => {
    const output = "头".repeat(20_000) + "中".repeat(20_000) + "尾".repeat(20_000);

    const truncated = truncateToolOutput(output);

    expect(utf8Encoder.encode(truncated).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_UTF8_BYTES);
    expect(truncated.startsWith("头")).toBe(true);
    expect(truncated.endsWith("尾")).toBe(true);
    expect(truncated).not.toContain("�");
    expect(truncated).toContain("[Tool output truncated:");
  });
});
