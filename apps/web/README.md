# Meme Wars Arena frontend

This Next.js App Router application is the frontend foundation for the game.
The lobby, arena, and results routes are present as placeholders. Wallet
connection, onchain reads and writes, trading, and scoring still need to be
implemented.

From this directory:

```sh
npm install
npm run dev
npm run lint
npm run build
```

Use `.env.example` as a template for `.env.local` when adding client RPC calls.
Only public values belong in `NEXT_PUBLIC_` environment variables.
