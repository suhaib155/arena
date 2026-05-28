import express from "express";
import { z } from "zod";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";

const router = express.Router();
const hexService = new HexService();
const oracleService = new OracleService();

// GET /zones/:hexId — zone info and mint eligibility
router.get("/:hexId", async (req, res) => {
  const { hexId } = req.params;
  try {
    const activity = await hexService.getHexActivity(hexId);
    const eligibility = await hexService.getMintEligibility(hexId);
    return res.json({ hexId, activity, eligibility });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch zone data" });
  }
});

// POST /zones/mint — get oracle signature for zone minting
router.post("/mint", async (req, res) => {
  const schema = z.object({
    hexId: z.string(),
    walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { hexId, walletAddress } = parsed.data;

  const eligibility = await hexService.getMintEligibility(hexId);
  if (!eligibility.isEligible) {
    return res.status(403).json({ error: "Zone not eligible for minting", eligibility });
  }
  if (eligibility.topMover.toLowerCase() !== walletAddress.toLowerCase()) {
    return res.status(403).json({ error: "Not the top mover for this zone" });
  }

  const sig = await oracleService.signZoneMint(hexId, walletAddress, eligibility.mintCost);
  return res.json({ hexId, mintCost: eligibility.mintCost.toString(), oracleSig: sig });
});

export default router;



