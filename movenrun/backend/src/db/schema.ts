import { pgTable, text, integer, bigint, boolean, timestamp, real, index, unique } from "drizzle-orm/pg-core";

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
