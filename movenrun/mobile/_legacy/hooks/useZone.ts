import { useState, useEffect } from "react";
import { Zone, ZoneMintEligibility } from "@movenrun/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export function useZone(hexId: string | null) {
  const [zone, setZone] = useState<Zone | null>(null);
  const [eligibility, setEligibility] = useState<ZoneMintEligibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hexId) { setZone(null); setEligibility(null); return; }

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/zones/${hexId}`)
      .then((r) => r.json())
      .then((data) => {
        setZone(data.zone ?? null);
        setEligibility(data.eligibility ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hexId]);

  const requestMintSig = async (walletAddress: string) => {
    if (!hexId) throw new Error("No hex selected");
    const res = await fetch(`${API_BASE}/zones/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hexId, walletAddress }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ hexId: string; mintCost: string; oracleSig: string }>;
  };

  return { zone, eligibility, loading, error, requestMintSig };
}
