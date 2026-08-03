import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("Home", () => {
  it("renders the web placeholder text", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Pulse — web");
  });
});
