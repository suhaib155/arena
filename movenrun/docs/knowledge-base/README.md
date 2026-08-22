# MovenRun Knowledge Base

`MOVENRUN-KNOWLEDGE-BASE.md` is a single-file, self-contained technical source
of truth for MovenRun, written to be **uploaded into an AI project** so an
assistant can answer accurately about the product, codebase, economics, and
known defects.

## How to use it

**ChatGPT** — create a Project → *Add files* → upload the `.md`. Optionally add
to the Project instructions:

> Use MOVENRUN-KNOWLEDGE-BASE.md as the authoritative source on MovenRun.
> Respect its confidence tags: never present a `[DESIGNED]` item as live, never
> present $MOVE as an investment, and check §11 and §16 before claiming
> anything is finished.

**Claude** — create a Project → *Add content* → upload the `.md`. Same
instruction text works as Project custom instructions.

Anywhere else (Notion AI, Cursor, a RAG index): plain Markdown with stable
headings, so it chunks and retrieves cleanly.

## What is inside (24 sections)

| § | Section |
|---|---|
| 0 | How to use this document — confidence tags and answering rules |
| 1–2 | Identity card, fast facts, product model |
| 3–4 | Repository map, technology stack |
| 5 | System architecture and the end-to-end movement flow |
| 6–7 | Per-contract reference; deployment record and addresses |
| 8–10 | Backend, mobile, shared package and website |
| 11–12 | Build/CI/release; security posture |
| 13–14 | Tokenomics (designed vs coded); data model and privacy |
| 15–17 | Contract defect register; 15 further gaps found in review; doc drift |
| 18 | Prioritised fix plan (P0–P3) with effort and sequencing |
| 19–20 | Strengths and potential; weaknesses and risks |
| 21–22 | House rules; roadmap and phase gates |
| 23–24 | Glossary; canonical pre-written Q&A |

## The confidence tags

Every claim is tagged `[BUILT]`, `[PARTIAL]`, `[DESIGNED]`, or `[DEFECT]`.
Most mistakes people make about MovenRun come from treating a `[DESIGNED]`
claim as `[BUILT]`, so the tags are the most important convention in the file.

## Keeping it current

These parts go stale first — re-verify after any significant merge:

- §1.2 fast facts
- §11.2 test inventory
- §15 / §16 defect registers
- §17 documentation-drift table

## Safety

Contains no secrets, private keys, `.env` contents, or credentials. The only
addresses are public Base Sepolia **testnet** addresses already committed in
`contracts/deployments/baseSepolia.json`.

## Related

- `../partner-brief/` — the non-technical partner onboarding PDF
- `../ROADMAP.md` — canonical product scope
- `../CONTRACT_V1_DISCREPANCIES.md` — the source for §15
