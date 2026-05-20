import { Router } from "express";
import { z } from "zod";
import { OracleService } from "../services/oracle.service.js";
import { HexService } from "../services/hex.service.js";

const router = Router();
const oracleService = new OracleService();
const hexService = new HexService();

// POST /battles/declare — get oracle sig for challenge declaration
router.post("/declare", async (req, res) => {
  const schema = z.object({
    hexId: z.string(),
    challengerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { hexId, challengerAddress } = parsed.data;

  try {
    const activity = await hexService.getHexActivity(hexId);
    // Fetch defender's 30-day score for the oracle sig
    const defenderBaseScore = await hexService.getDefenderScore(hexId);
    const sig = await oracleService.signChallengeDeclaration(hexId, activity.topMover, defenderBaseScore);

    return res.json({
      hexId,
      defender: activity.topMover,
      defenderBaseScore: defenderBaseScore.toString(),
      oracleSig: sig,
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to build challenge declaration" });
  }
});

// GET /battles/:hexId — active battle info
router.get("/:hexId", async (req, res) => {
  const { hexId } = req.params;
  // TODO: query ZoneChallenge contract for active challenge
  return res.json({ hexId, status: "no_active_challenge" });
});

export default router;
