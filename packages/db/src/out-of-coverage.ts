import { db } from "./client";
import { outOfCoverageSignups } from "./schema";

export interface RecordOutOfCoverageSignupInput {
  email: string;
  suburb: string;
}

// F1.1 out-of-coverage branch: a bare INSERT, no dedupe, no account created.
// Callers (apps/web/app/api/out-of-coverage) are responsible for basic
// input shape validation before this is called.
export async function recordOutOfCoverageSignup(input: RecordOutOfCoverageSignupInput): Promise<void> {
  await db.insert(outOfCoverageSignups).values({ email: input.email, suburb: input.suburb });
}
