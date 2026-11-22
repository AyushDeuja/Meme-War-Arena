import Link from "next/link";

export const instant = false;

export default async function ArenaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16">
      <Link href="/" className="text-violet-300 hover:underline">
        ← Lobby
      </Link>
      <h1 className="text-4xl font-bold">Arena: {id}</h1>
      <p className="text-zinc-300">
        Frog King versus Cat Boss. Wallet connection, virtual trading, match
        countdown, and verified timing challenges will appear here.
      </p>
      <Link href={`/results/${encodeURIComponent(id)}`} className="text-violet-300 hover:underline">
        Results route preview →
      </Link>
    </main>
  );
}
