import { useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { healthVisual } from "@/components/ZoneCard";
import { colors, glow, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getLastSession } from "@/services/moveSession";
import {
  FORTIFY_DEFENSE_GAIN,
  HEALTH_LABEL,
  fortifiedToday,
  riskLabel,
  zoneStatus,
} from "@/lib/territory";
import type { IoniconName } from "@/types";
import { successFeedback, tapFeedback } from "@/lib/haptics";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const SHIELD_SIZE = 132;
/** Hex edge midpoint angles for the six fortify shield lines. */
const EDGE_ANGLES = [0, 60, 120, 180, 240, 300];

/**
 * Territory command card — Free Map Beta. Defend by moving (route touch),
 * fortify with Locked MOVE *preview* (nothing is spent), watch decay. All
 * local simulation: no defend battles, no deeds, no chain.
 */
export default function ZoneDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const zone = useGameStore((s) => s.zones.find((z) => z.id === id));
  const fortifyZone = useGameStore((s) => s.fortifyZone);
  const hasSession = getLastSession() !== null;
  const [justFortified, setJustFortified] = useState(false);

  const shield = useRef(EDGE_ANGLES.map(() => new Animated.Value(0))).current;
  const shieldRing = useRef(new Animated.Value(0)).current;

  if (!zone) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textFaint} />
          <Text style={styles.missingText}>That zone isn&apos;t in your portfolio.</Text>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const status = zoneStatus(zone);
  const visual = healthVisual(status.health);
  const onCooldown = fortifiedToday(zone);
  const dormant = status.health === "dormant";

  const fortify = () => {
    tapFeedback();
    const updated = fortifyZone(zone.id);
    if (!updated) return;
    successFeedback();
    setJustFortified(true);
    /* six shield lines draw around the hex, then the ring glows */
    Animated.sequence([
      Animated.stagger(
        80,
        shield.map((v) =>
          Animated.spring(v, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
        ),
      ),
      Animated.timing(shieldRing, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>Zone</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Emblem + fortify shield overlay */}
        <View style={styles.hero}>
          <View style={styles.emblemWrap}>
            <Animated.View
              style={[
                styles.shieldRing,
                {
                  opacity: shieldRing.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }),
                  transform: [
                    { scale: shieldRing.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                  ],
                },
              ]}
            />
            <Hexagon size={88} color={visual.fill} coreColor={visual.core} />
            {EDGE_ANGLES.map((deg, i) => (
              <Animated.View
                key={deg}
                style={[
                  styles.shieldLine,
                  {
                    transform: [
                      { rotate: `${deg}deg` },
                      { translateY: -SHIELD_SIZE / 2 },
                      { scaleX: shield[i] },
                    ],
                    opacity: shield[i],
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.name}>{zone.name}</Text>
          <View style={styles.chipsRow}>
            <View style={[styles.chip, { backgroundColor: `${visual.core}1A` }]}>
              <Text style={[styles.chipText, { color: visual.text }]}>
                {HEALTH_LABEL[status.health]}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.chipText, { color: colors.textDim }]}>Common Zone</Text>
            </View>
          </View>
          <Text style={styles.zoneId}>{zone.id}</Text>
        </View>

        {/* Meters + risk */}
        <View style={styles.meterCard}>
          <MeterRow
            title="Defense"
            value={status.defense}
            color={status.health === "yours" ? palette.pulseGreen : palette.heatCoral}
          />
          <MeterRow title="Control" value={status.control} color={palette.voltMint} />
          <View style={styles.riskRow}>
            <View style={styles.riskLeft}>
              <Ionicons
                name={status.risk >= 65 ? "warning" : "pulse"}
                size={14}
                color={status.risk >= 35 ? palette.heatCoral : palette.pulseGreen}
              />
              <Text style={styles.riskLabel}>Threat</Text>
            </View>
            <Text
              style={[
                styles.riskValue,
                { color: status.risk >= 35 ? "#C2492E" : "#0A8F60" },
              ]}
            >
              {riskLabel(status.risk)} · {status.risk}%
            </Text>
          </View>
          <Text style={styles.meterNote}>
            Defense drains 12%/day without movement. Control holds while defense
            stands. Defend by moving through this zone, or fortify below.
          </Text>
        </View>

        {/* Timeline */}
        <View style={styles.timeline}>
          <TimeRow icon="flag" tint={palette.pulseGreen} label="Captured" when={formatWhen(zone.capturedAt)} />
          <TimeRow icon="navigate" tint={palette.baseBlue} label="Last defended" when={formatWhen(zone.lastDefendedAt)} />
          <TimeRow
            icon="shield"
            tint={palette.deedViolet}
            label={`Fortified ×${zone.fortifyCount}`}
            when={formatWhen(zone.lastFortifiedAt)}
          />
        </View>

        {justFortified ? (
          <View style={styles.fortifiedNote}>
            <Ionicons name="shield-checkmark" size={15} color={palette.baseBlue} />
            <Text style={styles.fortifiedNoteText}>
              Fortified — defense +{FORTIFY_DEFENSE_GAIN}. Come back tomorrow to
              fortify again.
            </Text>
          </View>
        ) : null}

        <Text style={styles.betaNote}>
          Local territory preview · on-device simulation. Fortify preview uses
          in-app Locked MOVE progress only — nothing is spent.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {dormant ? (
          <Button label="Reclaim soon" icon="time-outline" variant="secondary" disabled onPress={() => {}} />
        ) : (
          <Button
            label={onCooldown ? "Fortified today" : "Fortify zone"}
            icon="shield"
            disabled={onCooldown}
            onPress={fortify}
          />
        )}
        <Button
          label="Start Move to defend"
          icon="navigate"
          variant="secondary"
          onPress={() => {
            tapFeedback();
            router.push("/move");
          }}
        />
        {hasSession ? (
          <Button
            label="View route summary"
            icon="analytics-outline"
            variant="ghost"
            onPress={() => router.push("/move/summary")}
          />
        ) : null}
        <Button label="Back to Today" icon="home" variant="ghost" onPress={() => router.dismissAll()} />
      </View>
    </Screen>
  );
}

function MeterRow({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <View style={styles.meterBlock}>
      <View style={styles.meterRow}>
        <Text style={styles.meterTitle}>{title}</Text>
        <Text style={styles.meterValue}>{value}%</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.max(value, 2)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function TimeRow({ icon, tint, label, when }: { icon: IoniconName; tint: string; label: string; when: string }) {
  return (
    <View style={styles.timeRow}>
      <View style={[styles.timeIcon, { backgroundColor: `${tint}14` }]}>
        <Ionicons name={icon} size={13} color={tint} />
      </View>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeWhen}>{when}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.lg, gap: spacing.lg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  topTitle: { ...type.heading, fontSize: 16 },
  hero: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  emblemWrap: {
    width: SHIELD_SIZE + 28,
    height: SHIELD_SIZE + 28,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldRing: {
    position: "absolute",
    width: SHIELD_SIZE + 18,
    height: SHIELD_SIZE + 18,
    borderRadius: (SHIELD_SIZE + 18) / 2,
    borderWidth: 2.5,
    borderColor: palette.baseBlue,
    ...glow(palette.baseBlue),
  },
  shieldLine: {
    position: "absolute",
    width: 34,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: palette.baseBlue,
    ...glow(palette.baseBlue),
  },
  name: { ...type.display, fontSize: 26 },
  chipsRow: { flexDirection: "row", gap: spacing.sm },
  chip: { paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  chipText: { fontSize: 12, fontWeight: "700" },
  zoneId: { ...type.mono, fontSize: 11.5, color: colors.textFaint },
  meterCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  meterBlock: { gap: 6 },
  meterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meterTitle: { ...type.heading, fontSize: 14.5 },
  meterValue: { ...type.mono, fontSize: 13, fontWeight: "700", color: colors.text },
  meterTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: radius.pill },
  riskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.xs,
  },
  riskLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  riskLabel: { ...type.heading, fontSize: 14.5 },
  riskValue: { ...type.mono, fontSize: 12.5, fontWeight: "700" },
  meterNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint, lineHeight: 16 },
  timeline: { gap: spacing.sm },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  timeIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  timeLabel: { ...type.caption, fontSize: 13, color: colors.text, fontWeight: "600", flex: 1 },
  timeWhen: { ...type.mono, fontSize: 11, color: colors.textFaint },
  fortifiedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.baseBlue}10`,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  fortifiedNoteText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },
  betaNote: {
    ...type.mono,
    fontSize: 10.5,
    color: colors.textFaint,
    textAlign: "center",
    lineHeight: 16,
  },
  footer: { paddingVertical: spacing.md, gap: spacing.xs },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  missingText: { ...type.body },
});
