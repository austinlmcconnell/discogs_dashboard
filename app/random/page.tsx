import { redirect } from "next/navigation";
import { connection } from "next/server";
import { fetchFullCollection } from "@/lib/discogs";

export const dynamic = "force-dynamic";

export default async function RandomPage() {
  await connection();
  const releases = await fetchFullCollection();
  if (releases.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-semibold">No records found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your Discogs collection appears to be empty.
        </p>
      </div>
    );
  }
  const pick = releases[Math.floor(Math.random() * releases.length)];
  redirect(`/album/${pick.basic_information.id}?from=spin`);
}
