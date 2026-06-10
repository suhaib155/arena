import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { StatCard } from "@/components/StatCard";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { RoutePath } from "@/components/RoutePath";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { zoneStatus } from "@/lib/territory";
import { tapFeedback } from "@/lib/haptics";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const questsCompleted = useGameStore((s) => s.questsCompleted);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const reset = useGameStore((s) => s.reset);
  const statuses = zones.map((z) => ({ zone: z, status: zoneStatus(z) }));
  const atRiskCount = statuses.filter((e) => e.status.health !== "yours").length;
  const strongest =
    [...statuses].sort(
      (a, b) =>
        b.status.defense + b.status.control - (a.status.defense + a.status.control),
    )[0] ?? null;
  const level = getLevelInfo(totalXp);
  const lockedMove = lockedMovePreview(totalXp);

  const onReset = () => {
    tapFeedback();
    reset();
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Movement identity card */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={32} color={colors.primary} />
              </View>
            </View>
            <Text style={styles.name}>Mover</Text>
            <Text style={styles.subtitle}>
              Level {level.level} · {totalXp.toLocaleString()} XP total
            </Text>
            <View style={styles.heroBar}>
              <RoutePath
                progress={level.progress}
                label={`${level.xpForLevel - level.xpIntoLevel} XP to level ${level.level + 1}`}
              />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.statsRow}>
            <StatCard icon="flame" value={streak} label="Day streak" tint={palette.heatCoral} />
            <StatCard icon="trophy" value={level.level} label="Level" tint={colors.primary} />
            <StatCard
              icon="checkmark-done"
              value={questsCompleted}
              label="Completed"
              tint={palette.pulseGreen}
            />
          </View>
        </FadeSlideIn>

        {/* Locked MOVE — in-app progress only */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.moveCard}>
            <View style={styles.moveIcon}>
              <Hexagon size={20} color={palette.moveGold} />
            </View>
            <View style={styles.moveText}>
              <Text style={styles.moveValue}>{lockedMove.toLocaleString()} Locked MOVE</Text>
              <Text style={styles.moveNote}>
                Preview · in-app progress, not a payout. Unlocks with the
                territory beta.
              </Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Territory portfolio — captured common zones (local simulation) */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.portfolio}>
            <View style={styles.portfolioHexes}>
              {zones.length === 0 ? (
                <>
                  <Hexagon size={26} color="#E8EDF0" />
                  <Hexagon size={26} color="#E8EDF0" />
                  <Hexagon size={26} color="#C9EEDE" coreColor={palette.pulseGreen} />
                </>
              ) : (
                <>
                  {zones.slice(0, 3).map((z) => (
                    <Hexagon key={z.id} size={26} color="#C9EEDE" coreColor={palette.pulseGreen} />
                  ))}
                  {zones.length > 3 ? (
                    <Text style={styles.portfolioMore}>+{zones.length - 3}</Text>
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.portfolioText}>
              <Text style={styles.portfolioTitle}>Territory portfolio</Text>
              <Text style={styles.portfolioNote}>
                {zones.length === 0
                  ? "0 zones owned — capture a zone with a saved session."
                  : `${zones.length} common zone${zones.length === 1 ? "" : "s"} · defended ×${timesDefended}`}
              </Text>
              {strongest ? (
                <Text style={styles.portfolioNote}>
                  Strongest: {strongest.zone.name}
                  {atRiskCount > 0 ? ` · ${atRiskCount} at risk` : " · all stable"}
                </Text>
              ) : null}
            </View>
          </View>
        </FadeSlideIn>

        <SectionHeader
          title="Recent activity"
          trailing={history.length ? `${history.length}` : undefined}
        />
        {history.length === 0 ? (
          <EmptyState
            icon="walk-outline"
            title="No moves yet"
            message="Complete your first quest to earn XP and start a daily streak."
            actionLabel="Browse quests"
            onAction={() => router.navigate("/")}
          />
        ) : (
          <View style={styles.list}>
            {history.slice(0, 10).map((rec, i) => (
              <View key={`${rec.questId}-${i}`} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="checkmark" size={15} color={palette.pulseGreen} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{rec.questTitle}</Text>
                  <Text style={styles.rowTime}>{timeAgo(rec.completedAt)}</Text>
                </View>
                <Text style={styles.rowXp}>+{rec.xp} XP</Text>
              </View>
            ))}
          </View>
        )}

        {history.length > 0 ? (
          <Button
            label="Reset progress"
            variant="ghost"
            icon="refresh-outline"
            onPress={onReset}
            style={styles.resetBtn}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  hero: {
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.float,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: palette.pulseGreen,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { ...type.title, fontSize: 24 },
  subtitle: { ...type.caption, fontSize: 14 },
  heroBar: { alignSelf: "stretch", marginTop: spacing.md },
  statsRow: { flexDirection: "row", gap: spacing.md },
  moveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  moveIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: `${palette.moveGold}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  moveText: { flex: 1, gap: 2 },
  moveValue: { ...type.heading, fontSize: 16 },
  moveNote: { ...type.caption, fontSize: 12, lineHeight: 16 },
  portfolio: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  portfolioHexes: { flexDirection: "row", alignItems: "center", gap: 4 },
  portfolioMore: { ...type.caption, fontSize: 12, fontWeight: "700", color: "#0A8F60" },
  portfolioText: { flex: 1, gap: 2 },
  portfolioTitle: { ...type.heading, fontSize: 15 },
  portfolioNote: { ...type.caption, fontSize: 12 },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: `${palette.pulseGreen}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { ...type.heading, fontSize: 14.5 },
  rowTime: { ...type.caption, fontSize: 12, color: colors.textFaint },
  rowXp: { ...type.mono, fontSize: 13, color: "#B07908", fontWeight: "700" },
  resetBtn: { marginTop: spacing.xs, alignSelf: "center" },
});
