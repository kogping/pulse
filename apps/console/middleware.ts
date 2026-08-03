import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();

  if (process.env.VERCEL_ENV !== "production") {
    response.headers.set("X-Robots-Tag", "noindex");
  }

  return response;
}

export const config = {
  matcher: "/:path*",
};
