import "dotenv/config";
import { z } from "zod";
import fs from "fs";
import path from "path";

// Load deployed contract addresses from deployments/baseSepolia.json when in staging
function loadDeployedAddresses(network: "baseSepolia" | "base"): Record<string, string> {
  try {
    const deploymentPath = path.resolve(
      __dirname,
      "../../contracts/deployments",
      `${network}.json`
    );
    if (fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      return deployment.addresses ?? {};
    }
  } catch {
    // No deployment file — return empty (env vars take precedence)
  }
  return {};
}

const envSchema = z.object({
  PORT:     z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),

  DATABASE_URL: z.string().url(),
  REDIS_URL:    z.string().url(),

  ORACLE_PRIVATE_KEY:   z.string().startsWith("0x"),
  BASE_RPC_URL:         z.string().url(),
  BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
  CHAIN_ID:             z.coerce.number().default(84532),

  // Contract addresses — optional; overridden by deployment file when NODE_ENV=staging|production
  MOVE_TOKEN_ADDRESS:        z.string().startsWith("0x").optional(),
  GPS_ORACLE_ADDRESS:        z.string().startsWith("0x").optional(),
  ZONE_NFT_ADDRESS:          z.string().startsWith("0x").optional(),
  GEAR_NFT_ADDRESS:          z.string().startsWith("0x").optional(),
  ZONE_CHALLENGE_ADDRESS:    z.string().startsWith("0x").optional(),
  MOVE_VAULT_ADDRESS:        z.string().startsWith("0x").optional(),
  SEASON_CONTROLLER_ADDRESS: z.string().startsWith("0x").optional(),
  MOVEN_DAO_ADDRESS:         z.string().startsWith("0x").optional(),

  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),
  H3_RESOLUTION:     z.coerce.number().default(8),
});

export type Config = z.infer<typeof envSchema>;

export interface ContractAddresses {
  moveToken:        string;
  gpsOracle:        string;
  zoneNFT:          string;
  gearNFT:          string;
  zoneChallenge:    string;
  moveVault:        string;
  seasonController: string;
  movenDAO:         string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.format());
    process.exit(1);
  }
  _config = parsed.data;
  return _config;
}

// Returns contract addresses for the current environment.
// Priority: env vars > deployment JSON > throw
export function getContractAddresses(): ContractAddresses {
  const cfg = getConfig();

  let deployed: Record<string, string> = {};

  if (cfg.NODE_ENV === "staging") {
    deployed = loadDeployedAddresses("baseSepolia");
  } else if (cfg.NODE_ENV === "production") {
    deployed = loadDeployedAddresses("base");
  }
  // development/test: relies solely on env vars (localhost hardhat)

  function resolve(envVal: string | undefined, key: string): string {
    const val = envVal ?? deployed[key] ?? "";
    if (!val) {
      if (cfg.NODE_ENV === "development" || cfg.NODE_ENV === "test") {
        // Return zero address as placeholder for local dev
        return "0x0000000000000000000000000000000000000000";
      }
      throw new Error(`Contract address not configured for ${key} in ${cfg.NODE_ENV}`);
    }
    return val;
  }

  return {
    moveToken:        resolve(cfg.MOVE_TOKEN_ADDRESS,        "MoveToken"),
    gpsOracle:        resolve(cfg.GPS_ORACLE_ADDRESS,        "GPSOracle"),
    zoneNFT:          resolve(cfg.ZONE_NFT_ADDRESS,          "ZoneNFT"),
    gearNFT:          resolve(cfg.GEAR_NFT_ADDRESS,          "GearNFT"),
    zoneChallenge:    resolve(cfg.ZONE_CHALLENGE_ADDRESS,    "ZoneChallenge"),
    moveVault:        resolve(cfg.MOVE_VAULT_ADDRESS,        "MoveVault"),
    seasonController: resolve(cfg.SEASON_CONTROLLER_ADDRESS, "SeasonController"),
    movenDAO:         resolve(cfg.MOVEN_DAO_ADDRESS,         "MovenDAO"),
  };
}

