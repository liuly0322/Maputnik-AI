import React, { type ReactNode } from "react";

// Style-spec documentation only needs a small, safe subset of Markdown. Agent
// messages keep using react-markdown because they may contain full GFM syntax.
type TextNode = {
  type: "text"
  value: string
};

type InlineNode = TextNode | {
  type: "code" | "strong" | "em"
  value?: string
  children?: InlineNode[]
} | {
  type: "link"
  href: string
  children: InlineNode[]
} | {
  type: "image"
  src: string
  alt: string
};

export type MarkdownBlock = {
  type: "paragraph" | "heading"
  children: InlineNode[]
  level?: number
} | {
  type: "unordered-list" | "ordered-list"
  items: InlineNode[][]
} | {
  type: "code"
  value: string
  language?: string
} | {
  type: "blockquote"
  children: MarkdownBlock[]
} | {
  type: "thematic-break"
};

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function isSafeUrl(value: string) {
  try {
    const protocol = new URL(value, "https://maputnik.invalid").protocol;
    return SAFE_PROTOCOLS.has(protocol);
  }
  catch {
    return false;
  }
}

function addText(nodes: InlineNode[], value: string) {
  if (!value) return;

  const previous = nodes[nodes.length - 1];
  if (previous?.type === "text") {
    previous.value += value;
  }
  else {
    nodes.push({ type: "text", value });
  }
}

function findClosingBracket(text: string, start: number) {
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    }
    else if (text[i] === "]") {
      return i;
    }
  }
  return -1;
}

function findDestinationEnd(text: string, start: number) {
  let nestedParentheses = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    }
    else if (text[i] === "(") {
      nestedParentheses++;
    }
    else if (text[i] === ")") {
      if (nestedParentheses === 0) return i;
      nestedParentheses--;
    }
  }
  return -1;
}

function getDestination(value: string) {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed.split(/\s+/, 1)[0];

  return unwrapped && isSafeUrl(unwrapped) ? unwrapped : undefined;
}

function parseLink(text: string, start: number) {
  const image = text.startsWith("![", start);
  const labelStart = start + (image ? 2 : 1);
  const labelEnd = findClosingBracket(text, labelStart);

  if (labelEnd < 0 || text[labelEnd + 1] !== "(") return undefined;

  const destinationStart = labelEnd + 2;
  const destinationEnd = findDestinationEnd(text, destinationStart);
  if (destinationEnd < 0) return undefined;

  const destination = getDestination(text.slice(destinationStart, destinationEnd));
  if (!destination) return undefined;

  return {
    image,
    label: text.slice(labelStart, labelEnd),
    destination,
    end: destinationEnd + 1
  };
}

function canOpenEmphasis(text: string, index: number, marker: string) {
  const before = text[index - 1] || "";
  const after = text[index + marker.length] || "";

  if (!after || /\s/.test(after)) return false;
  // An underscore inside a word is text, not an emphasis delimiter.
  return marker !== "_" || !(/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after));
}

function canCloseEmphasis(text: string, index: number, marker: string) {
  const before = text[index - 1] || "";
  const after = text[index + marker.length] || "";

  if (!before || /\s/.test(before)) return false;
  return marker !== "_" || !(/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after));
}

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let plainText = "";

  const flushText = () => {
    addText(nodes, plainText.replace(/\s*\n\s*/g, " "));
    plainText = "";
  };

  for (let i = 0; i < text.length;) {
    if (text[i] === "\\" && /[\\`*_[\]{}()#+\-.!]/.test(text[i + 1] || "")) {
      plainText += text[i + 1];
      i += 2;
      continue;
    }

    if (text[i] === "`") {
      let markerLength = 1;
      while (text[i + markerLength] === "`") markerLength++;
      const marker = "`".repeat(markerLength);
      const end = text.indexOf(marker, i + markerLength);

      if (end >= 0) {
        flushText();
        nodes.push({
          type: "code",
          value: text.slice(i + markerLength, end).trim()
        });
        i = end + markerLength;
        continue;
      }
    }

    if (text.startsWith("![", i) || text[i] === "[") {
      const link = parseLink(text, i);
      if (link) {
        flushText();
        if (link.image) {
          nodes.push({ type: "image", src: link.destination, alt: link.label });
        }
        else {
          nodes.push({
            type: "link",
            href: link.destination,
            children: parseInline(link.label)
          });
        }
        i = link.end;
        continue;
      }
    }

    const strongMarker = text.startsWith("**", i)
      ? "**"
      : text.startsWith("__", i) ? "__" : undefined;
    if (strongMarker && canOpenEmphasis(text, i, strongMarker)) {
      const end = text.indexOf(strongMarker, i + strongMarker.length);
      if (end > i + strongMarker.length && canCloseEmphasis(text, end, strongMarker)) {
        flushText();
        nodes.push({
          type: "strong",
          children: parseInline(text.slice(i + strongMarker.length, end))
        });
        i = end + strongMarker.length;
        continue;
      }
    }

    if ((text[i] === "*" || text[i] === "_") && canOpenEmphasis(text, i, text[i])) {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end > i + 1 && canCloseEmphasis(text, end, marker)) {
        flushText();
        nodes.push({
          type: "em",
          children: parseInline(text.slice(i + 1, end))
        });
        i = end + 1;
        continue;
      }
    }

    plainText += text[i];
    i++;
  }

  flushText();
  return nodes;
}

function isBlank(line: string) {
  return /^\s*$/.test(line);
}

function getFence(line: string) {
  return line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w-]+)?\s*$/);
}

function getListItem(line: string) {
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (unordered) return { ordered: false, value: unordered[1] };

  const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, value: ordered[1] };

  return undefined;
}

function isThematicBreak(line: string) {
  return /^(?:\s{0,3}(?:\*[ \t]*){3,}|\s{0,3}(?:-[ \t]*){3,}|\s{0,3}(?:_[ \t]*){3,})$/.test(line);
}

function isBlockStart(line: string) {
  return !!getFence(line) ||
    /^\s{0,3}#{1,6}\s+/.test(line) ||
    !!getListItem(line) ||
    /^\s{0,3}>/.test(line) ||
    isThematicBreak(line);
}

// This pure helper is exported for focused parser tests; the file also exports the React component below.
// eslint-disable-next-line react-refresh/only-export-components
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index++;
      continue;
    }

    const fence = getFence(lines[index]);
    if (fence) {
      const fenceMarker = fence[1][0];
      const fenceLength = fence[1].length;
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !new RegExp(`^\\s{0,3}${fenceMarker}{${fenceLength},}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({
        type: "code",
        value: codeLines.join("\n"),
        language: fence[2]
      });
      continue;
    }

    const heading = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2])
      });
      index++;
      continue;
    }

    if (isThematicBreak(lines[index])) {
      blocks.push({ type: "thematic-break" });
      index++;
      continue;
    }

    const firstListItem = getListItem(lines[index]);
    if (firstListItem) {
      const items: InlineNode[][] = [];
      const ordered = firstListItem.ordered;

      while (index < lines.length) {
        if (isBlank(lines[index])) {
          let next = index;
          while (next < lines.length && isBlank(lines[next])) next++;
          const nextItem = next < lines.length ? getListItem(lines[next]) : undefined;
          if (nextItem && nextItem.ordered === ordered) {
            index = next;
            continue;
          }
          break;
        }

        const item = getListItem(lines[index]);
        if (!item || item.ordered !== ordered) break;
        let value = item.value;
        index++;

        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !getListItem(lines[index])) {
          value += " " + lines[index].trim();
          index++;
        }
        items.push(parseInline(value));
      }

      blocks.push({
        type: ordered ? "ordered-list" : "unordered-list",
        items
      });
      continue;
    }

    if (/^\s{0,3}>/.test(lines[index])) {
      const quoteLines: string[] = [];
      while (index < lines.length && (/^\s{0,3}>/.test(lines[index]) || isBlank(lines[index]))) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index++;
      }
      blocks.push({ type: "blockquote", children: parseMarkdown(quoteLines.join("\n")) });
      continue;
    }

    const paragraphLines = [lines[index]];
    index++;
    while (index < lines.length && !isBlank(lines[index]) && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index++;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraphLines.join("\n")) });
  }

  return blocks;
}

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return <code key={key}>{node.value}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children || [], key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children || [], key)}</em>;
      case "link":
        return <a key={key} href={node.href} target="_blank" rel="noreferrer">
          {renderInline(node.children, key)}
        </a>;
      case "image":
        return <img key={key} src={node.src} alt={node.alt} loading="lazy" />;
    }
  });
}

function renderBlocks(blocks: MarkdownBlock[], keyPrefix = "block"): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.type) {
      case "paragraph":
        return <p key={key}>{renderInline(block.children, key)}</p>;
      case "heading":
        return React.createElement(`h${block.level}`, { key }, renderInline(block.children, key));
      case "unordered-list":
        return <ul key={key}>{block.items.map((item, itemIndex) =>
          <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
        )}</ul>;
      case "ordered-list":
        return <ol key={key}>{block.items.map((item, itemIndex) =>
          <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
        )}</ol>;
      case "code":
        return <pre key={key}>
          <code className={block.language ? `language-${block.language}` : undefined}>{block.value}</code>
        </pre>;
      case "blockquote":
        return <blockquote key={key}>{renderBlocks(block.children, key)}</blockquote>;
      case "thematic-break":
        return <hr key={key} />;
    }
  });
}

export const MiniMarkdown: React.FC<{children: string}> = ({children}) => {
  return <>{renderBlocks(parseMarkdown(children))}</>;
};
