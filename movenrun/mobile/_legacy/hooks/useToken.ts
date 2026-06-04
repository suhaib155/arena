import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store/index.js";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export function useToken() {
  const walletAddress = useStore((s) => s.walletAddress);
  const moveBalance = useStore((s) => s.moveBalance);
  const setMoveBalance = useStore((s) => s.setMoveBalance);
  const [currentRate, setCurrentRate] = useState<string | null>(null);
  const [dailyCapRemaining, setDailyCapRemaining] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/users/${walletAddress}`);
      const data = await res.json();
      setCurrentRate(data.currentRate);
      setDailyCapRemaining(data.dailyCapRemaining);
    } catch (e) {
      console.error("useToken fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { moveBalance, currentRate, dailyCapRemaining, loading, refresh };
}
