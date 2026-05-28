import express from "express";
import { TokenService } from "../services/token.service.js";

const router = express.Router();
const tokenService = new TokenService();

// GET /users/:address — user stats
router.get("/:address", async (req, res) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  try {
    const stats = await tokenService.getUserStats(address);
    return res.json({ address, ...stats });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch user stats" });
  }
});

export default router;



