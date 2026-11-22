# Codex instructions — Meme Wars Arena

Read `idea.md`, `requirement.md`, `setup.md`, and `development-phases.md` before writing code.

## Working agreement
- The user gives a **phase number**. Implement **only that phase**; no silent future-phase features.
- First inspect existing repository files, package versions, SDK examples and tests. Never assume the Anchor workspace name or RPC is correct.
- Before changes, provide a concise plan, target files and expected acceptance tests.
- After changes, report exact commands actually executed, results, files modified, outstanding blockers and a GO/NO-GO decision. Append this to `docs/phase-log.md`.
- Do not report builds or transaction execution as successful without actually running them.
- Do not replace real MagicBlock ER integration with a mock while claiming the hackathon requirement is met.
- Solana accounts, programs and authorized server verifier are authoritative; frontend input is untrusted. Never store secrets in code or client-visible environment variables.
- The meme with highest verified skill score wins; AMM price **never** decides the winner. Trading portfolio competition is separate and uses *indicative virtual credits*, with no financial claims or payouts.
- AMM must use checked fixed-point integer arithmetic; prefer conservative rounding that preserves the constant-product invariant; test slippage, overflow, no-free-credit and replay resistance.
- Match length is 90 seconds, two fixed memes, 1,000 credits per wallet per round, five scoring slots per team, maximum three timing attempts per player; verified best attempt counts.
- Avoid feature creep: one match/arena, two meme pools, one timing challenge, working ER settlement. VRF and badges are optional.
- On failures, stop at current gate, explain what is blocked and propose the smallest next fix.

## Required end-of-phase report
```
PHASE:
CHANGED FILES:
COMMANDS EXECUTED:
PASS/FAIL/SKIPPED:
CHAIN VERIFICATION (if applicable):
RISKS/BLOCKERS:
GO / NO-GO:
NEXT PHASE (do not start):
```
