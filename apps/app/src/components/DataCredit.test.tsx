import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION } from "@sr/core";
import { DataCredit, SAMPLE_DATA_NOTICE } from "./DataCredit";

describe("DataCredit", () => {
  it("credits start.gg with a link for live data", () => {
    const html = renderToStaticMarkup(<DataCredit demo={false} />);
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain("https://www.start.gg/");
  });

  it("says sample data, with no start.gg credit or link, in demo mode", () => {
    const html = renderToStaticMarkup(<DataCredit demo />);
    expect(html).toContain(SAMPLE_DATA_NOTICE);
    expect(html).not.toContain(ATTRIBUTION);
    expect(html).not.toContain("https://www.start.gg/");
  });
});
