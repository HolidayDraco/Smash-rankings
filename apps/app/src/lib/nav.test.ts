import { describe, expect, it } from "vitest";
import { activeTab } from "./nav";

describe("activeTab", () => {
  it("marks Dashboard for the home page and every player page", () => {
    expect(activeTab("/")).toBe("/");
    expect(activeTab("/player/123-sample-dash")).toBe("/");
  });

  it("marks Texas for /texas and anything under it", () => {
    expect(activeTab("/texas")).toBe("/texas");
    expect(activeTab("/texas/austin")).toBe("/texas");
  });

  it("marks no tab for hidden pages and look-alike paths", () => {
    for (const path of ["/style-guide", "/status", "/methodology", "/player", "/texasfoo"]) {
      expect(activeTab(path)).toBeNull();
    }
  });
});
