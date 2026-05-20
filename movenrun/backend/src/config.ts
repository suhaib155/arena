import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ORACLE_PRIVATE_KEY: z.string().startsWith("0x"),
  BASE_RPC_URL: z.string().url(),
  BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
  CHAIN_ID: z.coerce.number().default(84532),

  MOVE_TOKEN_ADDRESS: z.string().startsWith("0x").optional(),
  ZONE_NFT_ADDRESS: z.string().startsWith("0x").optional(),
  GEAR_NFT_ADDRESS: z.string().startsWith("0x").optional(),
  ZONE_CHALLENGE_ADDRESS: z.string().startsWith("0x").optional(),
  SEASON_CONTROLLER_ADDRESS: z.string().startsWith("0x").optional(),

  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),

  H3_RESOLUTION: z.coerce.number().default(8),
});

export type Config = z.infer<typeof envSchema>;

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
