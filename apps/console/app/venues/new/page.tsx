import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { VenueForm } from "../venue-form";

export default async function NewVenuePage() {
  const session = await auth();
  if (!session) redirect("/signin");

  return (
    <main>
      <h1>New venue</h1>
      <VenueForm mode="create" />
    </main>
  );
}
