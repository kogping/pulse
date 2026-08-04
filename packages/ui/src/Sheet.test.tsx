import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <Sheet title="Filters" open={false} onClose={vi.fn()}>
        <p>content</p>
      </Sheet>,
    );
    expect(html).toBe("");
  });

  it("renders as a labeled dialog with its children when open", () => {
    const html = renderToStaticMarkup(
      <Sheet title="Filters" open onClose={vi.fn()}>
        <p>Live music tonight</p>
      </Sheet>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain("Live music tonight");
  });
});
