import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VenueCard } from "./VenueCard";

describe("VenueCard", () => {
  it("renders name, precinct, and attribute badges", () => {
    const html = renderToStaticMarkup(
      <VenueCard
        name="The Lansdowne"
        precinct="Chippendale"
        attributes={[
          { label: "Cover", attribute: { confidence: "fresh", value: "$15", lastVerifiedAt: new Date() } },
          { label: "Dress code", attribute: { confidence: "unconfirmed" } },
        ]}
      />,
    );
    expect(html).toContain("The Lansdowne");
    expect(html).toContain("Chippendale");
    expect(html).toContain("Cover: $15");
    expect(html).toContain("Dress code: unconfirmed");
  });

  it("omits the countdown when no lastEntry is given", () => {
    const html = renderToStaticMarkup(<VenueCard name="Test" precinct="CBD" attributes={[]} />);
    expect(html).not.toContain("scheduled, not live");
  });

  it("degrades to a scheduled label when last entry is not live", () => {
    const html = renderToStaticMarkup(
      <VenueCard
        name="Test"
        precinct="CBD"
        attributes={[]}
        lastEntry={{ mode: "scheduled", label: "Last entry 1:00 AM" }}
      />,
    );
    expect(html).toContain("scheduled, not live");
  });
});
