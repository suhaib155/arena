import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Hexagon } from "./Hexagon";
import { ResourcePill } from "./ResourcePill";
import { colors, palette, radius, spacing, type } from "@/theme";
import { hudProgress } from "@/lib/playerRank";

interface PlayerHudProps {
  /** Display name. The store has no profile name yet, so screens pass "Mover". */
  name: string;
  totalXp: number;
  /** Locked MOVE *preview*, already derived (see lib/lockedMove.ts). */
  lockedMove: number;
  /**
   * Show the level bar and the "N XP to level M" line.
   *
   * On by default because the bar is the reason the header exists. Off for a
   * live session, where two lines of progression compete with the distance the
   * player is actually looking at.
   */
  showLevelBar?: boolean;
  /** Right-hand slot: a notification bell, a close control, a status chip. */
  trailing?: ReactNode;
}

/**
 * The resource header — who you are and what you hold, in the same place on
 * every screen that shows progression.
 *
 * This is the piece the app was missing. Progress lived in a stat card on Home,
 * a different stat card on Profile, and nowhere at all on the map or a session,
 * so there was no continuous sense of *a player* moving through the game —
 * every screen re-introduced you. A persistent header is how a game says "this
 * is your run", and it costs about 76pt to say it.
 *
 * ## Honesty, which is not optional here
 *
 * XP is real local progress. **Locked MOVE is not a balance** — there is no
 * ledger, nothing is earned and nothing is spent; the figure is derived from XP
 * purely so the shape of the reward loop is visible (`lib/lockedMove.ts`). A
 * gold pill sitting beside a real XP total is exactly how a preview gets read
 * as a wallet, so the qualifier is rendered *inside* the pill and the spoken
 * label states it in full. It travels with the component to every screen; it is
 * not a footnote one screen remembers to add.
 *
 * ## Layout
 *
 * Identity left, resources right, and the resources wrap under the name rather
 * than truncating: at a large font scale a row of `name + 2 pills + bell` does
 * not fit 320pt, and a header that clips the player's level is worse than one
 * that grows by 24pt.
 */
export function PlayerHud({
  name,
  totalXp,
  lockedMove,
  showLevelBar = true,
  trailing,
}: PlayerHudProps) {
  const hud = hudProgress(totalXp, name);

  return (
    <View style={styles.wrap} accessible={false}>
      <View style={styles.row}>
        <View style={styles.crest}>
          <Hexagon size={40} color={colors.primaryDim} />
          <View style={styles.crestGlyph}>
            <Ionicons name="person" size={17} color={colors.primary} />
          </View>
        </View>

        <View style={styles.identity} accessible accessibilityLabel={hud.accessibilityLabel}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rank} numberOfLines={1}>
            LV {hud.level} · {hud.rank.toUpperCase()}
          </Text>
        </View>

        <View style={styles.pills}>
          <ResourcePill
            value={lockedMove.toLocaleString()}
            unit="MOVE"
            tone="gold"
            note="preview"
            accessibilityLabel={`${lockedMove.toLocaleString()} Locked MOVE, a preview of in-app progress — not a balance and not a payout.`}
          />
          <ResourcePill value={hud.xpLabel} unit="XP" tone="violet" />
        </View>

        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>

      {showLevelBar ? (
        <View style={styles.barRow}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(hud.progress * 100)}%` }]} />
          </View>
          <Text style={styles.next} numberOfLines={1}>
            {hud.nextLevelLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingTop: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    /* Wraps rather than truncates — see the layout note above. */
    flexWrap: "wrap",
  },
  crest: { alignItems: "center", justifyContent: "center" },
  crestGlyph: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  identity: { flexShrink: 1, minWidth: 0, gap: 1 },
  name: { ...type.heading, fontSize: 15.5 },
  rank: { ...type.kicker, fontSize: 9.5, letterSpacing: 0.9, color: colors.textDim },
  pills: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 1,
    minWidth: 0,
    marginLeft: "auto",
  },
  trailing: { marginLeft: spacing.xs },
  barRow: { gap: 5 },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  /* Base Blue and not Pulse Green: the level bar is progression, and green is
     already spoken for by held territory everywhere else in the app. */
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: palette.baseBlue },
  next: { ...type.caption, fontSize: 11, color: colors.textDim, textAlign: "right" },
});
