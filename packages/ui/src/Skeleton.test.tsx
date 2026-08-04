import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("announces a status role with the given label", () => {
    const html = renderToStaticMarkup(<Skeleton label="Loading venue" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading venue"');
  });

  it("defaults to a generic loading label", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('aria-label="Loading"');
  });
});
