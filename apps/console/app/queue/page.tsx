import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";
import { QueueRunner } from "./queue-runner";

export default async function QueuePage() {
  const session = await auth();
  if (!session) redirect("/signin");

  // A curator with no precinct assigned gets an explicit explainer, not the
  // ordinary "queue cleared" state — those two must be visually and
  // semantically distinguishable (a misconfigured curator should never be
  // able to mistake "nothing to do" for "something is wrong with my
  // account").
  if (!session.precinctId) {
    return (
      <main className="flex min-h-dvh flex-col bg-ink-950 px-6 pt-safe-t text-ink-50">
        <h1 className="py-4 text-lg font-semibold">Queue</h1>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-base font-medium">No precinct assigned</p>
          <p className="text-sm text-ink-300">Ask an admin to set your precinct before you can verify venues.</p>
        </div>
      </main>
    );
  }

  const items = await queueStore.nextBatch(session.curatorId, 20);

  return <QueueRunner initialItems={items} />;
}
