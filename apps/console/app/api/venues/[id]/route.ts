import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateVenue } from "@/lib/venues";
import { venueStore } from "@/lib/venue-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.curatorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const venue = await venueStore.getWithDetails(id);
  if (!venue) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(venue);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.curatorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const result = await updateVenue(id, body, session.curatorId);
  if (result.status === 201) return NextResponse.json({ id: result.venueId }, { status: 200 });
  if (result.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ errors: result.errors }, { status: result.status });
}
