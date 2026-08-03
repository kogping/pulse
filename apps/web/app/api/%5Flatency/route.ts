import { redis, sql } from "@pulse/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbStart = performance.now();
  await sql`SELECT 1`;
  const dbMs = performance.now() - dbStart;

  const redisStart = performance.now();
  await redis.get("_latency-probe");
  const redisMs = performance.now() - redisStart;

  const totalMs = dbMs + redisMs;

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    dbMs,
    redisMs,
    totalMs,
  });
}
