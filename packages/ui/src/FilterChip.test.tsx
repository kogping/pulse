import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterChip } from "./FilterChip";

describe("FilterChip", () => {
  it("marks the selected chip as pressed", () => {
    const html = renderToStaticMarkup(<FilterChip label="Open now" selected onClick={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Open now");
  });

  it("marks an unselected chip as not pressed", () => {
    const html = renderToStaticMarkup(<FilterChip label="Live music" selected={false} onClick={() => {}} />);
    expect(html).toContain('aria-pressed="false"');
  });
});
