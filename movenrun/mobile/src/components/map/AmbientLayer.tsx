import React, { useEffect, useMemo, useRef, useState } from "react";
import MapboxGL from "@rnmapbox/maps";
import type { FeatureCollection } from "geojson";
import { COLORS } from "../../constants/colors";

interface Mover {
  id: string;
  lng: number;
  lat: number;
  vLng: number;
  vLat: number;
  trail: [number, number][];
}

interface Pulse {
  id: string;
  lng: number;
  lat: number;
  startTime: number;
}

interface Props {
  userLat: number;
  userLng: number;
  active: boolean;
}

const MOVER_COUNT = 6;
const TRAIL_LENGTH = 5;
const SPREAD_DEG = 0.003;
const SPEED = 0.00004;

function initMovers(lat: number, lng: number): Mover[] {
  return Array.from({ length: MOVER_COUNT }, (_, i) => {
    const angle = (i / MOVER_COUNT) * 2 * Math.PI + Math.random();
    return {
      id: `m${i}`,
      lat: lat + (Math.random() - 0.5) * SPREAD_DEG * 2,
      lng: lng + (Math.random() - 0.5) * SPREAD_DEG * 2,
      vLat: Math.sin(angle) * SPEED * (0.5 + Math.random()),
      vLng: Math.cos(angle) * SPEED * (0.5 + Math.random()),
      trail: [],
    };
  });
}

function stepMovers(movers: Mover[], userLat: number, userLng: number): Mover[] {
  return movers.map((m) => {
    let { lat, lng, vLat, vLng } = m;
    const dLat = lat - userLat;
    const dLng = lng - userLng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);

    if (dist > SPREAD_DEG * 3) {
      lat = userLat + (Math.random() - 0.5) * SPREAD_DEG;
      lng = userLng + (Math.random() - 0.5) * SPREAD_DEG;
      vLat = (Math.random() - 0.5) * SPEED;
      vLng = (Math.random() - 0.5) * SPEED;
    } else {
      lat += vLat + (Math.random() - 0.5) * SPEED * 0.3;
      lng += vLng + (Math.random() - 0.5) * SPEED * 0.3;
    }

    const trail: [number, number][] = [[m.lng, m.lat], ...m.trail].slice(0, TRAIL_LENGTH);
    return { ...m, lat, lng, vLat, vLng, trail };
  });
}

export function AmbientLayer({ userLat, userLng, active }: Props) {
  const [movers, setMovers] = useState<Mover[]>(() => initMovers(userLat, userLng));
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMovers(initMovers(userLat, userLng));
  }, []);

  useEffect(() => {
    if (!active) return;
    tickRef.current = setInterval(() => {
      setMovers((prev) => stepMovers(prev, userLat, userLng));
    }, 800);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [active, userLat, userLng]);

  useEffect(() => {
    pulseRef.current = setInterval(() => {
      const now = Date.now();
      const newPulse: Pulse = {
        id: `p${now}`,
        lat: userLat + (Math.random() - 0.5) * SPREAD_DEG * 2,
        lng: userLng + (Math.random() - 0.5) * SPREAD_DEG * 2,
        startTime: now,
      };
      setPulses((prev) => [...prev.filter((p) => now - p.startTime < 3500), newPulse]);
    }, 4000 + Math.random() * 3000);
    return () => { if (pulseRef.current) clearInterval(pulseRef.current); };
  }, [userLat, userLng]);

  const moverFC = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: movers.map((m) => ({
      type: "Feature",
      id: m.id,
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: { id: m.id },
    })),
  }), [movers]);

  const trailFC = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: movers
      .filter((m) => m.trail.length > 1)
      .map((m) => ({
        type: "Feature",
        id: `trail-${m.id}`,
        geometry: {
          type: "LineString",
          coordinates: [[m.lng, m.lat], ...m.trail],
        },
        properties: {},
      })),
  }), [movers]);

  const pulseFC = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: pulses.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { startTime: p.startTime },
    })),
  }), [pulses]);

  return (
    <>
      <MapboxGL.ShapeSource id="mover-trails" shape={trailFC}>
        <MapboxGL.LineLayer
          id="mover-trail-line"
          style={{
            lineColor: COLORS.frost,
            lineOpacity: 0.25,
            lineWidth: 1,
            lineBlur: 1,
          }}
        />
      </MapboxGL.ShapeSource>

      <MapboxGL.ShapeSource id="mover-dots" shape={moverFC}>
        <MapboxGL.CircleLayer
          id="mover-dot-glow"
          style={{
            circleRadius: 8,
            circleColor: COLORS.frost,
            circleOpacity: 0.12,
            circleBlur: 1,
          }}
        />
        <MapboxGL.CircleLayer
          id="mover-dot"
          style={{
            circleRadius: 3,
            circleColor: COLORS.frost,
            circleOpacity: 0.7,
            circleStrokeWidth: 1,
            circleStrokeColor: COLORS.frost,
            circleStrokeOpacity: 0.4,
          }}
        />
      </MapboxGL.ShapeSource>

      <MapboxGL.ShapeSource id="activity-pulses" shape={pulseFC}>
        <MapboxGL.CircleLayer
          id="pulse-ring"
          style={{
            circleRadius: [
              "interpolate", ["linear"],
              ["-", ["to-number", ["now"]], ["get", "startTime"]],
              0, 0, 800, 40, 2500, 80, 3500, 100,
            ] as any,
            circleColor: COLORS.gold,
            circleOpacity: 0,
            circleStrokeWidth: 2,
            circleStrokeColor: COLORS.gold,
            circleStrokeOpacity: [
              "interpolate", ["linear"],
              ["-", ["to-number", ["now"]], ["get", "startTime"]],
              0, 0, 400, 0.8, 2000, 0.4, 3500, 0,
            ] as any,
          }}
        />
      </MapboxGL.ShapeSource>
    </>
  );
}
