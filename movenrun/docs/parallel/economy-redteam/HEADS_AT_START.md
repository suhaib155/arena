# Track B: branch heads recorded before any write

Recorded 22 October 2026, 04:55 UTC, from `git fetch origin` and the GitHub pull request list. Track B branched from `feat/g34-server-holdings` because #129, #126 and #124 were closed into it a few minutes earlier (its head `cb27318` is a merge of `integration/g34-0011-1002-unapplied` `d440f3a`, which carries 0011 revision 3 and rule set 1002).

| PR | State at start | Branch | Head |
|---|---|---|---|
| — | base of this track | `feat/g34-server-holdings` | `cb27318d6654bf0e730fb05e9d523e9d60c8ced1` |
| #129 | closed, not merged (folded into #121) | `integration/g34-0011-1002-unapplied` | `d440f3a4e98e011f17b123b330ed4e71f551a9de` |
| #126 | closed, not merged (folded into #121) | `feat/g34-rules-1002` | `fb7cd5b8cf9634b4b91baf5fd05c56c52686e53f` |
| #124 | closed, not merged (folded into #121) | `feat/g34-storage-capacity` | `b3a39cb53c8153ba1bcb5252242d5f73c0421092` |
| #121 | open draft | `feat/g34-server-holdings` | `cb27318d6654bf0e730fb05e9d523e9d60c8ced1` |
| #123 | open draft (not in this base) | `feat/sim-churn-study` | `c428aa010abe72c852efffdaa0d313e5d950a839` |
| #122 | open draft (not in this base) | `research/g5-g7-economy` | `6eea3b4a2574acbf0f2c208d1f83dfbd80c2bee2` |
| #120 | open draft | `feat/sim-pilot-ruleset` | `e6cfe4223402563a601a9f0c70216c12bcd23d7b` |
| #119 | open draft | `feat/g4-clubs-districts` | `8f8333934fc111259810721fbc59010ba12928d0` |
| #118 | open draft | `feat/g3-strength-settlement` | `8b9b3faa06bdbc4a4048ef66c4e0c1e8032f5bbe` |
| #117 | open draft | `feat/g2-holding-ledger` | `bf1303120f77a80fc59770326af16f65bcb2d307` |
| #114 | open draft | `feat/g2-holding-model` | `97bbc0b513995b07f538ae9eadaa242ff7d69b75` |
| #109 | open draft | `feat/g0-economy-v3` | `e2ae062937e3bb73338c23e4d789a61c567b9b4c` |
| #127 | open draft (owned by the integration thread, untouched) | `docs/provenance-sweep-22oct` | `384150e1824cc764b7b8436c782d8069a10e03d4` |
| #128 | open draft (owned by the integration thread, untouched) | `ops/vercel-ignore-build` | `49c9fe96d399cbe076e8558da4ab0136cde4ac2b` |
| #125 | open draft (Track A/C boundary, untouched) | `preview/android-qa0-candidate` | `15f7f87604759763dfaf0ef583b3e944f7fba3ed` |
| — | `main` | `main` | `d344c3b9dfe34078cff8528175c72968b522440d` |
| — | Android release branch | `release/android-v1-cxfdbd` | `991ac6a889c3c088d7f11ccea1b7194774dfa802` |

Source document: the owner's "Game Economy V3, revision 2, 31 August 2026" PDF (26 pages), sha256 `fce134ced2a5798926e8ce781dfca0c4751d0b59181488f2962d6f7b58fc4478`. It is not committed here; section numbers are cited instead.

Write scope of this track: `movenrun/research/economy-redteam/` and `movenrun/docs/parallel/economy-redteam/` only. Nothing under `backend/src/gameplay/`, `backend/drizzle*`, `shared/src/`, `contracts/`, any migration, any deployment manifest or any shared evidence board is edited.
