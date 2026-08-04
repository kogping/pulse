import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders heading only when body and action are omitted", () => {
    const html = renderToStaticMarkup(<EmptyState heading="Nothing open right now" />);
    expect(html).toContain("Nothing open right now");
    expect(html).not.toContain("<button");
  });

  it("renders body and an action button when provided", () => {
    const html = renderToStaticMarkup(
      <EmptyState heading="No venues nearby" body="Try widening your search" action={{ label: "Clear filters", onClick: vi.fn() }} />,
    );
    expect(html).toContain("Try widening your search");
    expect(html).toContain("Clear filters");
  });
});
