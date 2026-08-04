import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders value and lastVerifiedAt for a fresh attribute", () => {
    const html = renderToStaticMarkup(
      <Badge
        label="Cover"
        attribute={{ confidence: "fresh", value: "$20", lastVerifiedAt: new Date(Date.now() - 5 * 60_000) }}
      />,
    );
    expect(html).toContain("Cover: $20");
    expect(html).toContain("5m ago");
  });

  it("never renders a value for an unconfirmed attribute", () => {
    const html = renderToStaticMarkup(<Badge label="Dress code" attribute={{ confidence: "unconfirmed" }} />);
    expect(html).toContain("Dress code: unconfirmed");
    expect(html).not.toContain("undefined");
  });

  it("does not typecheck a bare value without confidence (compile-time guard)", () => {
    // @ts-expect-error - BadgeAttribute is a discriminated union; a bare
    // value with no confidence tag must be a type error, not a runtime bug.
    const attribute: import("./Badge").BadgeAttribute = { value: "$20" };
    expect(attribute).toBeDefined();
  });
});
