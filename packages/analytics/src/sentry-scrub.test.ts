import { describe, expect, it } from "vitest";
import { scrubPii } from "./sentry-scrub";

describe("scrubPii", () => {
  it("drops coordinate keys at any depth", () => {
    const result = scrubPii({
      message: "checkin failed",
      user: { id: "u1", lat: -33.87, lng: 151.2 },
      extra: { coords: [1, 2], latitude: -33.87 },
    });

    expect(result).toEqual({
      message: "checkin failed",
      user: { id: "u1" },
      extra: {},
    });
  });

  it("drops email-named keys and redacts email-shaped string values", () => {
    const result = scrubPii({
      breadcrumbs: [{ category: "auth", message: "sent link to person@example.com" }],
      user: { email: "person@example.com", id: "u1" },
    });

    expect(result).toEqual({
      breadcrumbs: [{ category: "auth", message: "sent link to [redacted-email]" }],
      user: { id: "u1" },
    });
  });

  it("passes through values with no PII unchanged", () => {
    const result = scrubPii({ event_id: "abc123", level: "error", tags: { region: "syd1" } });

    expect(result).toEqual({ event_id: "abc123", level: "error", tags: { region: "syd1" } });
  });
});
