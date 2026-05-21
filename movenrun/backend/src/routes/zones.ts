import { Router } from "express";
import { z } from "zod";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";

const router = Router();
const hexService = new HexService();
const oracleService = new OracleService();

// GET /zones/:hexId — zone info and mint eligibility
router.get("/:hexId", async (req, res) => {
  const { hexId } = req.params;
  try {
    const [activity, eligibility] = await Promise.all([
      hexService.getHexActivity(hexId),
      hexService.getMintEligibility(hexId),
    ]);
    return res.json({ success: true, hexId, activity, eligibility });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Zones] GET /:hexId error", { hexId, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch zone data",
      code: "INTERNAL_ERROR",
    });
  }
});

// POST /zones/mint — get oracle signature for zone minting
router.post("/mint", async (req, res) => {
  const schema = z.object({
    hexId: z.string().min(1),
    walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
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

  const { hexId, walletAddress } = parsed.data;

  try {
    const eligibility = await hexService.getMintEligibility(hexId);
    if (!eligibility.isEligible) {
      return res.status(403).json({
        success: false,
        error: "Zone not eligible for minting",
        code: "NOT_ELIGIBLE",
        eligibility,
      });
    }
    if (eligibility.topMover.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: "Not the top mover for this zone",
        code: "NOT_TOP_MOVER",
        topMover: eligibility.topMover,
      });
    }

    const sig = await oracleService.signZoneMint(hexId, walletAddress, eligibility.mintCost);
    return res.json({
      success: true,
      hexId,
      mintCost: eligibility.mintCost.toString(),
      oracleSig: sig,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Zones] POST /mint error", { hexId, walletAddress, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to generate mint signature",
      code: "INTERNAL_ERROR",
    });
  }
});

export default router;
