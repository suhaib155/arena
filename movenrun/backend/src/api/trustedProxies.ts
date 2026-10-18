/**
 * Which addresses in front of the API may tell it who the client is.
 *
 * Counting hops (TRUST_PROXY_HOPS) only works when every request crosses the
 * same number of proxies, and the right count can only be guessed from the
 * outside. Naming the proxies' networks does not depend on the count: Express
 * walks X-Forwarded-For from the right, skips every address in these networks
 * and takes the first one outside them. That is the address that connected to
 * Cloudflare, which a client cannot choose: anything it writes into the header
 * itself sits further left and is never reached. `Forwarded` is never read.
 *
 * The staging API answers through Cloudflare (server: cloudflare, cf-ray) and
 * then Render's own proxies, which use private addresses. If Render ever hands
 * on only its own peer, the result is a Cloudflare address: visitors share a
 * bucket, but nobody can pick one. scripts/check-client-ip.mjs tells the two
 * apart after a deploy.
 */

// Published at https://www.cloudflare.com/ips-v4 and /ips-v6 (read 17 Oct 2026).
// Cloudflare changes these rarely and announces it; re-read before a deploy.
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
] as const;

// Addresses no internet client arrives from: the host's own and its private
// network (loopback, link-local, 10/8, 172.16/12, 192.168/16, fc00::/7), plus
// carrier-grade NAT space, which is translated before it reaches the internet.
export const PRIVATE_RANGES = ["loopback", "linklocal", "uniquelocal", "100.64.0.0/10"] as const;

export type TrustProxyMode = "hops" | "render-cloudflare";

/** The value for Express's "trust proxy" setting. */
export function trustProxySetting(mode: TrustProxyMode, hops: number): number | string[] {
  return mode === "render-cloudflare" ? [...PRIVATE_RANGES, ...CLOUDFLARE_RANGES] : hops;
}
