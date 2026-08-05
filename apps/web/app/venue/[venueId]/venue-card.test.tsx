import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttributeView } from "@pulse/db";
import { VenueAttributeCard } from "./venue-card";

const CURATOR = { curatorId: "c1", name: "Sam", tier: "core" };

describe("VenueAttributeCard", () => {
  it("renders a fresh attribute with its value and a verified-by line", () => {
    const attributes: AttributeView[] = [
      {
        key: "cover_charge",
        value: "$15",
        confidence: "fresh",
        lastVerifiedAt: new Date(Date.now() - 5 * 60_000),
        verifiedBy: CURATOR,
      },
    ];
    const html = renderToStaticMarkup(<VenueAttributeCard venueId="v1" attributes={attributes} />);
    expect(html).toContain("$15");
    expect(html).toContain("Verified 5m ago by Sam");
  });

  it("renders an ageing attribute de-emphasised with a may-have-changed note", () => {
    const attributes: AttributeView[] = [
      {
        key: "dress_code",
        value: "smart casual",
        confidence: "ageing",
        lastVerifiedAt: new Date(Date.now() - 3 * 60 * 60_000),
        verifiedBy: CURATOR,
      },
    ];
    const html = renderToStaticMarkup(<VenueAttributeCard venueId="v1" attributes={attributes} />);
    expect(html).toContain("smart casual");
    expect(html).toContain("Last checked 3h ago");
    expect(html).toContain("may have changed");
  });

  it("renders unconfirmed with no attribute value text at all", () => {
    const attributes: AttributeView[] = [{ key: "queue_length", confidence: "unconfirmed" }];
    const html = renderToStaticMarkup(<VenueAttributeCard venueId="v1" attributes={attributes} />);
    expect(html).toContain("Not confirmed");
    // "queue_length" never had a value assigned in this fixture, so any of
    // its known option strings leaking through would mean the unconfirmed
    // branch read a value it must never touch.
    expect(html).not.toContain("short (<10 min)");
    expect(html).not.toContain("moderate (10-20 min)");
    expect(html).not.toContain("long (20+ min)");
    expect(html).not.toContain("Verified");
    expect(html).not.toContain("Last checked");
  });

  it("covers all three confidence states together without cross-contamination", () => {
    const attributes: AttributeView[] = [
      {
        key: "price_tier",
        value: "$$",
        confidence: "fresh",
        lastVerifiedAt: new Date(Date.now() - 10 * 60_000),
        verifiedBy: CURATOR,
      },
      {
        key: "dress_code",
        value: "casual",
        confidence: "ageing",
        lastVerifiedAt: new Date(Date.now() - 26 * 60 * 60_000),
        verifiedBy: CURATOR,
      },
      { key: "wheelchair_accessible", confidence: "unconfirmed" },
    ];
    const html = renderToStaticMarkup(<VenueAttributeCard venueId="v1" attributes={attributes} />);

    expect(html).toContain("$$");
    expect(html).toContain("Verified 10m ago by Sam");
    expect(html).toContain("casual");
    expect(html).toContain("Last checked 1d ago");
    expect(html).toContain("Not confirmed");
  });
});
