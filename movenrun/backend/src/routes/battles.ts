import { Router } from "express";
import { z } from "zod";

const router = Router();

// POST /battles/declare — get oracle sig for challenge declaration.
//
// GUARDED — not production-ready. ZoneChallenge.declareChallenge verifies the
// oracle signature over (chainId, hexId, zoneNFT.zoneOwner(hexId),
// defenderBaseScore). The oracle must therefore sign the REAL on-chain zone
// owner and a validated 30-day defender score. Today the backend only has stub
// values (`getHexActivity().topMover` is a zero address — not the zone owner —
// and `getDefenderScore()` returns 0), so signing here would emit an
// invalid/insecure declaration. The signer (`OracleService.signChallengeDeclaration`)
// now refuses zero/invalid inputs; wiring the real on-chain zone owner + a
// validated defender score is a follow-up (see PR description). Until then we
// return 501 rather than produce a bad signature.
router.post("/declare", async (req, res) => {
  const schema = z.object({
    hexId: z.string(),
    challengerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  return res.status(501).json({
    error: "challenge_declaration_not_wired",
    message:
      "Challenge declaration requires the on-chain zone owner and a validated defender base score, which are not yet available server-side. See follow-up PRs.",
    hexId: parsed.data.hexId,
  });
});

// GET /battles/:hexId — active battle info
router.get("/:hexId", async (req, res) => {
  const { hexId } = req.params;
  // TODO: query ZoneChallenge contract for active challenge
  return res.json({ hexId, status: "no_active_challenge" });
});

export default router;
