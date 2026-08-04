import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function QueuePage() {
  const session = await auth();
  if (!session) redirect("/signin");

  return (
    <main>
      <h1>Queue</h1>
      <p>Signed in as {session.user?.email}.</p>
    </main>
  );
}
