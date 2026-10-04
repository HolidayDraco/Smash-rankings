import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEMO_TAG_LABEL, DemoTag } from "./DemoTag";

describe("DemoTag", () => {
  it("has the visible words and a full accessible name", () => {
    const html = renderToStaticMarkup(<DemoTag />);
    expect(html).toContain("Demo data");
    expect(html).toContain(`aria-label="${DEMO_TAG_LABEL}"`);
  });
});
