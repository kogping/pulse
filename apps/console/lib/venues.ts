import { venueInputSchema } from "@pulse/db";
import { venueStore } from "./venue-store";

export type VenueMutationResult =
  | { status: 201; venueId: string }
  | { status: 400; errors: Record<string, string[]> }
  | { status: 404 }
  | { status: 409; errors: Record<string, string[]> };

function flattenErrors(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  const { fieldErrors } = error.flatten();
  const errors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages) errors[field] = messages;
  }
  return errors;
}

export async function createVenue(rawInput: unknown, curatorId: string): Promise<VenueMutationResult> {
  const parsed = venueInputSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, errors: flattenErrors(parsed.error) };

  const outcome = await venueStore.create(parsed.data, curatorId);
  if (!outcome.ok) return { status: 409, errors: { slug: ["That slug is already used in this precinct"] } };
  return { status: 201, venueId: outcome.venueId };
}

export async function updateVenue(venueId: string, rawInput: unknown, curatorId: string): Promise<VenueMutationResult> {
  const parsed = venueInputSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, errors: flattenErrors(parsed.error) };

  const outcome = await venueStore.update(venueId, parsed.data, curatorId);
  if (!outcome.ok) {
    if (outcome.reason === "not_found") return { status: 404 };
    return { status: 409, errors: { slug: ["That slug is already used in this precinct"] } };
  }
  return { status: 201, venueId: outcome.venueId };
}
