/** A tiny, safe markdown subset parser: headings, paragraphs, bullet lists, bold, italic, links. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; items: Inline[][] };

const INLINE = /\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: "text", text: source.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "italic", text: m[2] });
    else out.push({ kind: "link", text: m[3] ?? "", href: m[4] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const previous = blocks[blocks.length - 1];
    if (line.startsWith("## ")) blocks.push({ kind: "heading", text: line.slice(3) });
    else if (line.startsWith("- ")) {
      const item = parseInline(line.slice(2));
      if (previous?.kind === "list") previous.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else blocks.push({ kind: "paragraph", inline: parseInline(line) });
  }
  return blocks;
}
