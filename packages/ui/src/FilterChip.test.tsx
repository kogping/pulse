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

  it("renders as a link, not a button, when href is given", () => {
    const html = renderToStaticMarkup(<FilterChip label="Live music" selected href="/?filters=live_music" />);
    expect(html).toContain("<a ");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="/?filters=live_music"');
    expect(html).toContain('aria-pressed="true"');
  });
});
