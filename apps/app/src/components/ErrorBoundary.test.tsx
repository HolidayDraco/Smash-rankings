import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reportRenderError } from "../lib/sentry";
import { CrashPanel, ErrorBoundary } from "./ErrorBoundary";

vi.mock("../lib/sentry", () => ({ initSentry: vi.fn(), reportRenderError: vi.fn() }));

describe("ErrorBoundary", () => {
  it("renders its children while nothing has failed", () => {
    const boundary = new ErrorBoundary({ children: "all good" });
    expect(boundary.render()).toBe("all good");
  });

  it("switches to the fallback panel and reports the error", () => {
    const error = new Error("render failed");
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });

    const boundary = new ErrorBoundary({ children: "all good" });
    boundary.componentDidCatch(error, { componentStack: "\n    at Broken" });
    expect(reportRenderError).toHaveBeenCalledWith(error, "\n    at Broken");

    boundary.state = { failed: true };
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("all good");
  });
});

describe("CrashPanel", () => {
  it("is an announced alert with a heading and a labelled reload button", () => {
    const html = renderToStaticMarkup(<CrashPanel onReload={() => undefined} />);
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/role="heading"[^>]*aria-level="1"|aria-level="1"[^>]*role="heading"/);
    expect(html).toMatch(/role="button"/);
    expect(html).toContain('aria-label="Reload the page"');
    expect(html).toContain("Reload");
  });
});
