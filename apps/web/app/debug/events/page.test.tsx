import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DebugEventsPage from "./page";

describe("DebugEventsPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the empty state outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = renderToStaticMarkup(<DebugEventsPage />);
    expect(html).toContain("No events tracked yet");
  });

  it("404s in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => renderToStaticMarkup(<DebugEventsPage />)).toThrow();
  });
});
