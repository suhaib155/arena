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
    hexId: z.string().min(1),
    challengerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid input",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
  }

  const { hexId, challengerAddress } = parsed.data;

  try {
    const [activity, defenderBaseScore] = await Promise.all([
      hexService.getHexActivity(hexId),
      hexService.getDefenderScore(hexId),
    ]);

    if (!activity.topMover || activity.topMover === "0x0000000000000000000000000000000000000000") {
      return res.status(404).json({
        success: false,
        error: "Zone has no owner to challenge",
        code: "NO_ZONE_OWNER",
      });
    }

    if (activity.topMover.toLowerCase() === challengerAddress.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: "Cannot challenge your own zone",
        code: "SELF_CHALLENGE",
      });
    }

    const sig = await oracleService.signChallengeDeclaration(
      hexId,
      activity.topMover,
      defenderBaseScore
    );

    return res.json({
      success: true,
      hexId,
      defender: activity.topMover,
      defenderBaseScore: defenderBaseScore.toString(),
      oracleSig: sig,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Battles] POST /declare error", { hexId, challengerAddress, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to build challenge declaration",
      code: "INTERNAL_ERROR",
    });
  }
});

// GET /battles/:hexId — active battle info
router.get("/:hexId", async (req, res) => {
  const { hexId } = req.params;
  try {
    // TODO: query ZoneChallenge contract for active challenge
    return res.json({ success: true, hexId, status: "no_active_challenge" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Battles] GET /:hexId error", { hexId, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch battle data",
      code: "INTERNAL_ERROR",
    });
  }
});

export default router;
