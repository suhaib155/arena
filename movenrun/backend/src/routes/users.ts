import { Router } from "express";
import { TokenService } from "../services/token.service.js";

const router = Router();
const tokenService = new TokenService();

// GET /users/:address — user stats
router.get("/:address", async (req, res) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({
      success: false,
      error: "Invalid Ethereum address",
      code: "INVALID_ADDRESS",
    });
  }

  try {
    const stats = await tokenService.getUserStats(address);
    return res.json({ success: true, address, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Users] GET /:address error", { address, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch user stats",
      code: "INTERNAL_ERROR",
    });
  }
});

export default router;
