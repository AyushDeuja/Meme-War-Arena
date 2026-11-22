import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">
        Meme Wars Arena
      </p>
      <h1 className="max-w-2xl text-5xl font-bold tracking-tight sm:text-6xl">
        Back your meme. Play the battle. Trade the momentum.
      </h1>
      <p className="max-w-2xl text-lg text-zinc-300">
        A 90-second skill showdown with a fictional market. Battle points come
        from verified play; virtual share prices come from trades.
      </p>
      <div className="rounded-2xl border border-white/15 bg-white/5 p-6">
        <h2 className="text-xl font-semibold">Frontend foundation</h2>
        <p className="mt-2 text-zinc-300">
          The lobby, arena, and results routes are ready for wallet connection,
          live match state, trading, and the timing challenge. Gameplay is not
          connected yet.
        </p>
        <Link
          href="/arena/demo"
          className="mt-5 inline-flex rounded-lg bg-violet-400 px-5 py-3 font-semibold text-zinc-950 hover:bg-violet-300"
        >
          Preview arena route
        </Link>
      </div>
      <p className="text-sm text-zinc-400">
        Virtual credits and shares have no cash value or redemption.
      </p>
    </main>
  );
}
