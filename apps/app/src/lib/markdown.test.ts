import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METHODOLOGY_MARKDOWN } from "./methodologyCopy";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, and grouped bullets", () => {
    const blocks = parseMarkdown("## Title\n\nHello **bold** and _soft_.\n\n- one\n- two\n\nEnd");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "paragraph"]);
    expect(blocks[2]).toMatchObject({
      kind: "list",
      items: [expect.any(Array), expect.any(Array)],
    });
  });

  it("parses bold, italic, and https links, and leaves other schemes as plain text", () => {
    expect(parseInline("a **b** _c_ [d](https://e.test/x)")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "italic", text: "c" },
      { kind: "text", text: " " },
      { kind: "link", text: "d", href: "https://e.test/x" },
    ]);
    expect(parseInline("[x](javascript:alert(1))").some((i) => i.kind === "link")).toBe(false);
  });
});

describe("methodology copy", () => {
  it("matches docs/METHODOLOGY.md exactly (from the first section on)", () => {
    const doc = readFileSync(new URL("../../../../docs/METHODOLOGY.md", import.meta.url), "utf8");
    expect(METHODOLOGY_MARKDOWN.trim()).toBe(doc.slice(doc.indexOf("## What counts")).trim());
  });

  it("covers every topic the page promises", () => {
    const headings = parseMarkdown(METHODOLOGY_MARKDOWN).flatMap((b) =>
      b.kind === "heading" ? [b.text] : [],
    );
    expect(headings).toEqual([
      "What counts",
      "How a rating changes",
      'Why the leaderboard uses a "conservative score"',
      "Who appears on the leaderboard",
      "Rank change over 7 days",
      "Limits",
    ]);
  });
});
