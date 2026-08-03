import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("console middleware", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    process.env.VERCEL_ENV = originalVercelEnv;
  });

  it("sets X-Robots-Tag: noindex when VERCEL_ENV is not production", () => {
    process.env.VERCEL_ENV = "preview";
    const response = middleware(new NextRequest("https://console.example.com/"));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("omits X-Robots-Tag in production", () => {
    process.env.VERCEL_ENV = "production";
    const response = middleware(new NextRequest("https://console.example.com/"));
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("sets X-Robots-Tag when VERCEL_ENV is unset (local dev)", () => {
    delete process.env.VERCEL_ENV;
    const response = middleware(new NextRequest("https://console.example.com/"));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
