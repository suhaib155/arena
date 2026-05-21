import IORedis from "ioredis";
import { getConfig } from "../config.js";

let _redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (_redis) return _redis;
  const config = getConfig();
  _redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  return _redis;
}
