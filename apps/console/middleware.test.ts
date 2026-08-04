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

  it("redirects an unauthenticated request to /signin", () => {
    const response = middleware(new NextRequest("https://console.example.com/queue"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://console.example.com/signin");
  });

  it("does not redirect a request carrying a session cookie", () => {
    const request = new NextRequest("https://console.example.com/queue", {
      headers: { cookie: "authjs.session-token=some-token" },
    });
    const response = middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect /signin itself", () => {
    const response = middleware(new NextRequest("https://console.example.com/signin"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect /api/auth/* routes", () => {
    const response = middleware(new NextRequest("https://console.example.com/api/auth/session"));
    expect(response.headers.get("location")).toBeNull();
  });
});
