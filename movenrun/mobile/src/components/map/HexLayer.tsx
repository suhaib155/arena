import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapboxGL from "@rnmapbox/maps";
import * as h3 from "h3-js";
import type { FeatureCollection } from "geojson";
import { Zone, ZoneStatus, ZoneChallenge } from "@movenrun/shared";
import { COLORS } from "../../constants/colors";

type HexState = "UNMINTED" | "YOURS" | "ENEMY" | "ALLY" | "CONTESTED" | "DORMANT" | "CURRENT";

interface Props {
  visibleHexIds: string[];
  zones: Zone[];
  ownedZoneIds: string[];
  allyAddresses: string[];
  activeBattles: ZoneChallenge[];
  currentHexId: string | null;
  selectedHexId: string | null;
  onHexPress: (hexId: string) => void;
}

function resolveState(
  hexId: string,
  zone: Zone | null,
  ownedZoneIds: string[],
  allyAddresses: string[],
  currentHexId: string | null,
  activeBattles: ZoneChallenge[],
): HexState {
  if (hexId === currentHexId) return "CURRENT";
  if (!zone) return "UNMINTED";
  if (activeBattles.some((b) => b.hexId === hexId && !b.resolved)) return "CONTESTED";
  if (zone.status === ZoneStatus.Dormant) return "DORMANT";
  if (ownedZoneIds.includes(hexId)) return "YOURS";
  if (allyAddresses.includes(zone.owner)) return "ALLY";
  return "ENEMY";
}

function hexToPolygon(hexId: string): number[][] {
  const ring = h3.cellToBoundary(hexId).map(([lat, lng]) => [lng, lat]);
  ring.push(ring[0]);
  return ring;
}

function buildFC(hexIds: string[], stateOf: (id: string) => HexState): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: hexIds.map((hexId) => ({
      type: "Feature",
      id: hexId,
      geometry: { type: "Polygon", coordinates: [hexToPolygon(hexId)] },
      properties: { hexId, state: stateOf(hexId) },
    })),
  };
}

export function HexLayer({
  visibleHexIds,
  zones,
  ownedZoneIds,
  allyAddresses,
  activeBattles,
  currentHexId,
  selectedHexId,
  onHexPress,
}: Props) {
  const [yoursPulse, setYoursPulse] = useState(0);
  const [contestedPulse, setContestedPulse] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      frameRef.current += 1;
      const f = frameRef.current;
      setYoursPulse(Math.sin((f / 90) * 2 * Math.PI));
      setContestedPulse(Math.sin((f / 36) * 2 * Math.PI));
      timer = setTimeout(tick, 33);
    };
    timer = setTimeout(tick, 33);
    return () => clearTimeout(timer);
  }, []);

  const zoneMap = useMemo(() => {
    const m = new Map<string, Zone>();
    zones.forEach((z) => m.set(z.hexId, z));
    return m;
  }, [zones]);

  const stateOf = useCallback(
    (hexId: string) =>
      resolveState(hexId, zoneMap.get(hexId) ?? null, ownedZoneIds, allyAddresses, currentHexId, activeBattles),
    [zoneMap, ownedZoneIds, allyAddresses, currentHexId, activeBattles],
  );

  const { staticIds, yoursIds, contestedIds, currentIds } = useMemo(() => {
    const staticIds: string[] = [];
    const yoursIds: string[] = [];
    const contestedIds: string[] = [];
    const currentIds: string[] = [];
    for (const id of visibleHexIds) {
      const s = stateOf(id);
      if (s === "CURRENT") currentIds.push(id);
      else if (s === "YOURS") yoursIds.push(id);
      else if (s === "CONTESTED") contestedIds.push(id);
      else staticIds.push(id);
    }
    return { staticIds, yoursIds, contestedIds, currentIds };
  }, [visibleHexIds, stateOf]);

  const staticFC = useMemo(() => buildFC(staticIds, stateOf), [staticIds, stateOf]);
  const yoursFC = useMemo(() => buildFC(yoursIds, () => "YOURS"), [yoursIds]);
  const contestedFC = useMemo(() => buildFC(contestedIds, () => "CONTESTED"), [contestedIds]);
  const currentFC = useMemo(() => buildFC(currentIds, () => "CURRENT"), [currentIds]);

  const yoursFillOp = 0.22 + 0.08 * yoursPulse;
  const yoursLineOp = 0.78 + 0.12 * yoursPulse;
  const contestedFillOp = 0.20 + 0.12 * contestedPulse;
  const contestedLineOp = contestedPulse > 0 ? 1.0 : 0.6;

  const handlePress = (e: any) => {
    const feat = e?.features?.[0];
    if (feat?.properties?.hexId) onHexPress(feat.properties.hexId);
  };

  return (
    <>
      <MapboxGL.ShapeSource id="hexes-static" shape={staticFC} onPress={handlePress}>
        <MapboxGL.FillLayer
          id="hex-fill-static"
          style={{
            fillColor: ["match", ["get", "state"],
              "ENEMY", COLORS.enemy,
              "ALLY",  COLORS.violet,
              COLORS.signal,
            ] as any,
            fillOpacity: ["match", ["get", "state"],
              "ENEMY",   0.15,
              "ALLY",    0.15,
              "DORMANT", 0.0,
              0.08,
            ] as any,
          }}
        />
        <MapboxGL.LineLayer
          id="hex-line-solid"
          filter={["!=", ["get", "state"], "DORMANT"] as any}
          style={{
            lineColor: ["match", ["get", "state"],
              "ENEMY",  COLORS.enemy,
              "ALLY",   COLORS.violet,
              COLORS.signal,
            ] as any,
            lineOpacity: ["match", ["get", "state"],
              "ENEMY", 0.60,
              "ALLY",  0.60,
              0.30,
            ] as any,
            lineWidth: 1,
          }}
        />
        <MapboxGL.LineLayer
          id="hex-line-dashed"
          filter={["==", ["get", "state"], "DORMANT"] as any}
          style={{
            lineColor: COLORS.mist,
            lineOpacity: 0.20,
            lineWidth: 1,
            lineDasharray: [2, 3],
          }}
        />
      </MapboxGL.ShapeSource>

      <MapboxGL.ShapeSource id="hexes-yours" shape={yoursFC} onPress={handlePress}>
        <MapboxGL.FillLayer
          id="hex-fill-yours"
          style={{ fillColor: COLORS.signal, fillOpacity: yoursFillOp }}
        />
        <MapboxGL.LineLayer
          id="hex-line-yours"
          style={{ lineColor: COLORS.signal, lineOpacity: yoursLineOp, lineWidth: 1.5 }}
        />
      </MapboxGL.ShapeSource>

      <MapboxGL.ShapeSource id="hexes-contested" shape={contestedFC} onPress={handlePress}>
        <MapboxGL.FillLayer
          id="hex-fill-contested"
          style={{ fillColor: COLORS.ember, fillOpacity: contestedFillOp }}
        />
        <MapboxGL.LineLayer
          id="hex-line-contested"
          style={{ lineColor: COLORS.ember, lineOpacity: contestedLineOp, lineWidth: 2 }}
        />
      </MapboxGL.ShapeSource>

      <MapboxGL.ShapeSource id="hex-current" shape={currentFC} onPress={handlePress}>
        <MapboxGL.FillLayer
          id="hex-fill-current"
          style={{ fillColor: COLORS.signal, fillOpacity: 0.35 }}
        />
        <MapboxGL.LineLayer
          id="hex-line-current"
          style={{ lineColor: COLORS.signal, lineOpacity: 1.0, lineWidth: 2.5 }}
        />
      </MapboxGL.ShapeSource>

      {selectedHexId && !currentIds.includes(selectedHexId) && !yoursIds.includes(selectedHexId) && !contestedIds.includes(selectedHexId) && (
        <MapboxGL.ShapeSource
          id="hex-selected"
          shape={buildFC([selectedHexId], () => "UNMINTED")}
        >
          <MapboxGL.LineLayer
            id="hex-line-selected"
            style={{ lineColor: "#ffffff", lineOpacity: 0.8, lineWidth: 2 }}
          />
        </MapboxGL.ShapeSource>
      )}
    </>
  );
}
