import { NextResponse } from "next/server";
import { getInbox } from "@/lib/email";

// Test-only introspection endpoint for the in-memory email inbox. Inert in
// every environment except AUTH_TEST_MODE=1 (set only by playwright.config.ts),
// so it never exists as an attack surface in production.
export async function GET() {
  if (process.env.AUTH_TEST_MODE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ emails: getInbox() });
}
