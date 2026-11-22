import Link from "next/link";

export const instant = false;

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16">
      <Link href={`/arena/${encodeURIComponent(id)}`} className="text-violet-300 hover:underline">
        ← Arena
      </Link>
      <h1 className="text-4xl font-bold">Results: {id}</h1>
      <p className="text-zinc-300">
        The battle winner and indicative virtual portfolio leaderboard will be
        shown separately after onchain finalization.
      </p>
    </main>
  );
}
