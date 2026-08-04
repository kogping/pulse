import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("Home", () => {
  it("renders the venue feed shell with the design system components", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Pulse — what");
    expect(html).toContain("The Lansdowne");
    expect(html).toContain("Open now");
    expect(html).toContain("scheduled, not live");
  });
});
