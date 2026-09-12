import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import latest from "@maplibre/maplibre-gl-style-spec/dist/latest.json";
import { MiniMarkdown, parseMarkdown } from "./MiniMarkdown";

function collectDocs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];

  const ownDoc = "doc" in value && typeof value.doc === "string" ? [value.doc] : [];

  return ownDoc.concat(Object.values(value).flatMap(collectDocs));
}

describe("parseMarkdown", () => {
  it("renders the syntax used by style-spec documentation", () => {
    const [paragraph, list, code] = parseMarkdown(
      "A [`property`](https://example.com/MapLibre_style) with **details**.\n\n- [Example](assets/example.svg)\n\n```json\n{\"value\": true}\n```"
    );

    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "A " },
        {
          type: "link",
          href: "https://example.com/MapLibre_style",
          children: [{ type: "code", value: "property" }]
        },
        { type: "text", value: " with " },
        { type: "strong", children: [{ type: "text", value: "details" }] },
        { type: "text", value: "." }
      ]
    });
    expect(list).toMatchObject({
      type: "unordered-list",
      items: [[{
        type: "link",
        href: "assets/example.svg",
        children: [{ type: "text", value: "Example" }]
      }]]
    });
    expect(code).toMatchObject({
      type: "code",
      language: "json",
      value: "{\"value\": true}"
    });
  });

  it("keeps unsafe links as plain text", () => {
    const [paragraph] = parseMarkdown("[unsafe](javascript:alert(1))");
    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "[unsafe](javascript:alert(1))" }]
    });
  });

  it("does not interpret underscores inside ordinary words", () => {
    const [paragraph] = parseMarkdown("The `font_face` property and font_face value.");
    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "The " },
        { type: "code", value: "font_face" },
        { type: "text", value: " property and font_face value." }
      ]
    });
  });

  it("renders every current style-spec document", () => {
    const docs = collectDocs(latest);
    expect(docs).toHaveLength(620);

    const html = docs
      .map(doc => renderToStaticMarkup(React.createElement(MiniMarkdown, { children: doc })))
      .join("");

    expect(html).not.toContain("undefined");
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Khmer_script"');
    expect(html).toContain("<img");
    expect(html).toContain("language-json");
  });
});
