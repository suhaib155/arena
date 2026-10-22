/**
 * Production-facing claims Play v1 must not make without a label.
 *
 * The v1 promise is foreground walk/run, a real map and route, missions and XP,
 * and account/privacy controls. It is not transferable tokens, deeded land,
 * live rivalry or server-agreed ownership. Each rule names a claim class; a hit
 * that carries an honest label nearby (preview, local, not live, nothing is
 * spent, ...) is reported as LABELLED for review, and an unlabelled hit is a
 * FAILURE.
 *
 * Location-privacy absolutes ("never uploaded", "stays on your device") are
 * already banned by mobile/src/lib/__tests__/privacyTruth.test.ts and are not
 * repeated here.
 */
export interface ClaimRule {
  id: string;
  pattern: RegExp;
  why: string;
  /** "fail" blocks; "review" is preview vocabulary a human must see labelled on the rendering screen. */
  severity: "fail" | "review";
}

export const RULES: readonly ClaimRule[] = [
  { id: "OWNERSHIP", pattern: /\b(own|owns|owned|ownership|landowner)\b/i,
    why: "Nothing is owned in v1: zones are local preview state no server has agreed to.", severity: "fail" },
  { id: "CAPTURE", pattern: /\b(captur(e|ed|es|ing)|conquer(ed)?|defend(ed|s)?|claim(ed|s)? (a |the )?(zone|land|ground|tile))\b/i,
    why: "Capture and defence are local preview mechanics, not server-authoritative territory. The word is allowed only where the rendering screen labels it preview.", severity: "review" },
  { id: "TOKEN", pattern: /(\$MOVE|\bMOVE token|\bLocked MOVE\b|\bliquid MOVE\b|\btoken rewards?\b|\bNFTs?\b|\bDeeds?\b|\bairdrop)/i,
    why: "No token, NFT or Deed exists for players in v1.", severity: "fail" },
  { id: "MONEY", pattern: /\b(payouts?|pays? out|cash ?out|withdraw(al)?|real money|earn(ings)? money|treasury|liquidity)\b/i,
    why: "No financial value is earned or paid in v1.", severity: "fail" },
  { id: "RIVALRY", pattern: /\b(rivals?|leaderboards?|city war|ranked|ranking|sponsor zones?)\b/i,
    why: "There are no live other players in v1.", severity: "fail" },
  { id: "CHAIN", pattern: /(Base Sepolia|\bmainnet\b|\bon-?chain\b|0x[0-9a-fA-F]{40})/i,
    why: "Chain details are not part of the Play v1 promise and invite token assumptions.", severity: "fail" },
  { id: "INTEGRITY", pattern: /\b(anti-?cheat|cheat(er|ing)|fraud|banned for)\b/i,
    why: "v1 has no sanctions; accusing players is unsafe and unproven.", severity: "fail" },
];

/** An honest label within the same string or two lines either side. */
export const LABEL = /(preview|local( beta)?|not live|no rewards?|never pays?|not ownership|nothing is spent|arrive later|later|future|planned|coming|fictional|simulated|not real|demo|concept|no (minting|claiming|trading)|does not affect|not (affect )?ownership|read-only reference)/i;
