import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@pulse/ui", () => {
  it("exposes a package name placeholder", () => {
    expect(PACKAGE_NAME).toBe("@pulse/ui");
  });
});
