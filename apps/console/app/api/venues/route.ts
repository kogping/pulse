import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { createVenue } from "@/lib/venues";

export async function POST(request: Request) {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const body = await request.json();
  const result = await createVenue(body, session.curatorId);
  if (result.status === 201) return NextResponse.json({ id: result.venueId }, { status: 201 });
  if (result.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ errors: result.errors }, { status: result.status });
}
