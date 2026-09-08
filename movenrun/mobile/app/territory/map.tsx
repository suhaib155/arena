import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AreaMap } from "@/components/AreaMap";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ZoneSheet } from "@/components/ZoneSheet";
import { FirstTimeGuide } from "@/components/FirstTimeGuide";
import { DisplayHeading } from "@/components/DisplayHeading";
import { MeterRow } from "@/components/MeterRow";
import { GameBadge } from "@/components/GameBadge";
import { colors, ink, palette, spacing, tints, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { HEALTH_LABEL } from "@/lib/territory";
import { buildTerritoryOverview } from "@/lib/territoryMap";
import { heldCells } from "@/lib/mapCells";
import { tapFeedback } from "@/lib/haptics";

export default function TerritoryMapScreen() {
  const router = useRouter();
  const zones = useGameStore(s => s.zones);
  const hydrated = useGameStore(s => s._hydrated);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overview = useMemo(() => buildTerritoryOverview(zones, Date.now()), [zones]);
  const cells = useMemo(() => heldCells(zones, selectedId), [zones, selectedId]);
  const selected = overview.cells.find(cell => cell.zone.id === selectedId);
  const atRisk = overview.atRisk + overview.contestedPreview + overview.dormant;

  return <Screen>
    <ScreenHeader title="Territory" trailing={<Button label="Help" variant="ghost" icon="help-circle-outline" onPress={() => router.push({ pathname: "/help", params: { topic: "territory" } })} />} />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DisplayHeading eyebrow="YOUR GROUND" title="Make your mark." trailing={<GameBadge icon="map-outline" tone="green" size={40} />} />
      <AreaMap cells={cells} style={styles.map} onPressCell={cell => {
        tapFeedback(); setExpanded(false); setSelectedId(cell.id === selectedId ? null : cell.id);
      }} />
      <View style={styles.legend} accessibilityLabel="Map legend: neutral nearby cells, outlined current cell, green held preview cells">
        <Text style={styles.label}>Nearby</Text><Text style={styles.currentLegend}>Current cell</Text><Text style={styles.heldLegend}>Held · Preview</Text>
      </View>
      {selected ? <ZoneSheet
        zoneName={selected.zone.name}
        statusLabel={`Preview · ${HEALTH_LABEL[selected.status.health]}`}
        statusColor={palette.pulseGreen}
        activity="Your recorded progress"
        actionLabel="View zone"
        onAction={() => router.push({ pathname: "/zone/[id]", params: { id: selected.zone.id } })}
        expanded={expanded}
        onToggle={() => setExpanded(value => !value)}
        onClose={() => setSelectedId(null)}
        meters={[
          { label: "Control", value: selected.status.control, color: palette.baseBlue },
          { label: "Defence", value: selected.status.defense, color: palette.pulseGreen },
        ]}
      /> : <View style={styles.context}>
        <MeterRow items={[{ value: overview.total, label: "Preview zones", tone: "green" }, { value: atRisk, label: "Need a visit", tone: "gold" }]} />
        <Text style={styles.body}>{!hydrated ? "Loading your progress…" : overview.total ? "Choose a zone to explore." : "Your first mark starts with a move."}</Text>
        <Button label="Start Move" icon="walk-outline" onPress={() => router.push("/move")} />
      </View>}
    </ScrollView>
    {hydrated ? <FirstTimeGuide topic="territory" /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  kicker: { ...type.kicker, color: ink.green },
  title: { ...type.title, marginTop: spacing.xs },
  preview: { ...type.caption, color: ink.green },
  map: { minHeight: 410 },
  context: { gap: spacing.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  currentLegend: { ...type.caption, color: ink.green, borderWidth: 1, borderColor: palette.pulseGreen, paddingHorizontal: spacing.xs },
  heldLegend: { ...type.caption, color: ink.green, backgroundColor: tints.green, paddingHorizontal: spacing.xs },
  stats: { flexDirection: "row", gap: spacing.lg },
  stat: { flex: 1, gap: spacing.xs },
  number: { ...type.display, lineHeight: 42, includeFontPadding: true },
  label: { ...type.caption },
  body: { ...type.body, color: colors.textDim },
});
