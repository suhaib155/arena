import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  real,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Legacy tables (kept for compatibility) ──────────────────────────────────

export const routes = pgTable("routes", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  status: text("status").notNull().default("PENDING"),
  distanceMeters: integer("distance_meters"),
  routeHash: text("route_hash"),
  oracleSig: text("oracle_sig"),
  startTime: bigint("start_time", { mode: "number" }).notNull(),
  endTime: bigint("end_time", { mode: "number" }).notNull(),
  earnedAmount: text("earned_amount"),
  rejectionReasons: text("rejection_reasons").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  walletIdx: index("routes_wallet_idx").on(t.walletAddress),
  statusIdx: index("routes_status_idx").on(t.status),
}));

export const hexActivities = pgTable("hex_activities", {
  hexId: text("hex_id").primaryKey(),
  weeklyMoverCount: integer("weekly_mover_count").default(0).notNull(),
  monthlyMoverCount: integer("monthly_mover_count").default(0).notNull(),
  totalDistanceMeters: bigint("total_distance_meters", { mode: "bigint" }).default(0n).notNull(),
  topMover: text("top_mover"),
  topMoverDistanceMeters: bigint("top_mover_distance_meters", { mode: "bigint" }).default(0n).notNull(),
  lastActivityAt: timestamp("last_activity_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userRouteHexes = pgTable("user_route_hexes", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => routes.id),
  walletAddress: text("wallet_address").notNull(),
  hexId: text("hex_id").notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => ({
  hexUserIdx: index("hex_user_idx").on(t.hexId, t.walletAddress),
  routeIdx: index("user_route_hex_route_idx").on(t.routeId),
}));

export const zones = pgTable("zones", {
  hexId: text("hex_id").primaryKey(),
  tokenId: text("token_id").notNull(),
  owner: text("owner").notNull(),
  ownershipStart: timestamp("ownership_start").notNull(),
  lastActivity: timestamp("last_activity"),
  isDormant: boolean("is_dormant").default(false).notNull(),
  accumulatedYield: text("accumulated_yield").default("0").notNull(),
});

export const battles = pgTable("battles", {
  id: text("id").primaryKey(),
  hexId: text("hex_id").notNull(),
  challenger: text("challenger").notNull(),
  defender: text("defender").notNull(),
  challengeStart: timestamp("challenge_start").notNull(),
  challengeEnd: timestamp("challenge_end").notNull(),
  challengerScore: text("challenger_score").default("0"),
  defenderScore: text("defender_score").default("0"),
  resolved: boolean("resolved").default(false).notNull(),
  winner: text("winner"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  hexIdx: index("battles_hex_idx").on(t.hexId),
}));

// ─── New tables ───────────────────────────────────────────────────────────────

export const gpsSubmissions = pgTable("gps_submissions", {
  id: text("id").primaryKey(),
  userAddress: text("user_address").notNull(),
  routeHash: text("route_hash").unique(),
  gpsPoints: jsonb("gps_points").notNull(),
  hexActivity: jsonb("hex_activity"),
  distanceMeters: integer("distance_meters"),
  status: text("status").notNull().default("PENDING"),
  oracleSig: text("oracle_sig"),
  deviceId: text("device_id"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("gps_submissions_user_idx").on(t.userAddress),
  hashIdx: index("gps_submissions_hash_idx").on(t.routeHash),
  statusIdx: index("gps_submissions_status_idx").on(t.status),
}));

export const hexActivityDaily = pgTable("hex_activity_daily", {
  hexId: text("hex_id").notNull(),
  userAddress: text("user_address").notNull(),
  date: date("date").notNull(),
  distanceMeters: integer("distance_meters").notNull().default(0),
  moveEarned: text("move_earned").notNull().default("0"),
}, (t) => ({
  pk: primaryKey({ columns: [t.hexId, t.userAddress, t.date] }),
  hexDateIdx: index("hex_activity_daily_hex_date_idx").on(t.hexId, t.date),
  userDateIdx: index("hex_activity_daily_user_date_idx").on(t.userAddress, t.date),
}));

export const zoneChallenges = pgTable("zone_challenges", {
  hexId: text("hex_id").notNull(),
  challenger: text("challenger").notNull(),
  defender: text("defender").notNull(),
  startedAt: timestamp("started_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  challengerScore: text("challenger_score").notNull().default("0"),
  defenderScore: text("defender_score").notNull().default("0"),
  status: text("status").notNull().default("ACTIVE"),
  winner: text("winner"),
}, (t) => ({
  pk: primaryKey({ columns: [t.hexId, t.challenger, t.startedAt] }),
  hexIdx: index("zone_challenges_hex_idx").on(t.hexId),
  statusIdx: index("zone_challenges_status_idx").on(t.status),
}));

export const users = pgTable("users", {
  address: text("address").primaryKey(),
  gearMultiplier: real("gear_multiplier").notNull().default(1.0),
  dailyCapUsed: text("daily_cap_used").notNull().default("0"),
  lastResetAt: timestamp("last_reset_at").defaultNow().notNull(),
  stakedAmount: text("staked_amount").notNull().default("0"),
  zoneCount: integer("zone_count").notNull().default(0),
  seasonPoints: text("season_points").notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
