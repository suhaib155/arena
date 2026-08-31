# Safe claims matrix

The anti-overclaim gate. Every sentence in the application, the video, the
website and any recruitment message must be checkable against this table.

A claim is safe **only** in a column whose condition has actually happened. If
a column says No, the claim may not be made in that state — not softened, not
hedged, not implied.

| Claim | Safe now | After Sepolia | After mainnet | After real pilot |
|---|---|---|---|---|
| DeedRegistry implemented and tested | **Yes** — "in review" | Yes | Yes | Yes |
| One H3 cell maps to only one deed | **Yes** — enforced in tests | Yes | Yes | Yes |
| EIP-712 oracle-authorized claims | **Yes** — "in review" | Yes | Yes | Yes |
| Admin and oracle are separate keys | **Yes** — enforced by the constructor | Yes | Yes | Yes |
| No MOVE required to claim | **Yes** | Yes | Yes | Yes |
| Metadata endpoint implemented | **Yes** — "in review" | Yes | Yes | Yes |
| Local end-to-end claim proof (22/22) | **Yes** — say "locally" | Yes | Yes | Yes |
| Foreground movement tracking exists | **Yes** | Yes | Yes | Yes |
| Repeated-presence / decay mechanics exist | **Yes** — local simulation only | Yes | Yes | Yes |
| Registry deployed on Base Sepolia | **No** | Yes | Yes | Yes |
| Registry deployed on Base mainnet | **No** | **No** | Yes | Yes |
| Source verified on Basescan | **No** | Only if it actually verified | Only if it actually verified | Same |
| `totalSupply()` figure | **No** | Exact on-chain number | Exact on-chain number | Exact on-chain number |
| Unique holder count | **No** | **No** | **No** | Exact count of independent holders |
| A real verified movement authorized a real claim | **No** | Yes, if it did | Yes, if it did | Yes |
| Deeds are transferable in practice | **No** — only locally proven | Yes, if a transfer happened | Yes | Yes |
| Verified-footfall payments | **No** | **No** | **No** | **No** — not built |
| Deed income / yield / revenue share | **No** | **No** | **No** | **No** — does not exist |
| PvP / challenges | **No** | **No** | **No** | **No** — not built |
| Clubs, live social | **No** | **No** | **No** | **No** — local only |
| Enclosure capture | **No** | **No** | **No** | **No** — not built |
| MOVE token economy on the public product | **No** | **No** | **No** | **No** — not deployed |
| Server-authoritative territory / ownership | **No** | **No** | **No** | **No** — no writer exists |

## Wording rules

- Open PRs are **"implemented and in review"**, never "shipped", "live", or
  "in production".
- The local end-to-end proof is **"tested locally"**. It is not a deployment
  and must never be described as one.
- A Sepolia deployment is **"exercised on Base Sepolia"**. Never "live" — a
  reviewer who checks Basescan and finds a testnet address behind that word
  learns something worse about the project than a pending mainnet would.
- After mainnet, name **the specific contract**: "the MovenRun DeedRegistry is
  deployed on Base mainnet at `<address>`". Do not imply the other eight
  contracts moved; they remain on Sepolia unless actually redeployed.
- Holder counts are the exact count of **independent** holders. Deployer,
  admin, oracle and any project-controlled wallet are not participants.

## The four-holder rule

If the honest number is four, write four. A small true number survives
diligence. A large number that dissolves under a block-explorer check does not,
and it costs more than the application is worth.
