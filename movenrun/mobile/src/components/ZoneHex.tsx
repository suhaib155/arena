import React from "react";
import { Polygon } from "react-native-maps";
import * as h3 from "h3-js";
import { Zone, ZoneStatus } from "@movenrun/shared";

interface Props {
  hexId: string;
  zone: Zone | null;
  onPress: () => void;
}

function hexColor(zone: Zone | null): string {
  if (!zone) return "rgba(255,255,255,0.05)";
  switch (zone.status) {
    case ZoneStatus.Active: return "rgba(0,255,136,0.15)";
    case ZoneStatus.UnderChallenge: return "rgba(255,100,0,0.25)";
    case ZoneStatus.Dormant: return "rgba(100,100,100,0.15)";
    default: return "rgba(255,255,255,0.05)";
  }
}

function hexStroke(zone: Zone | null): string {
  if (!zone) return "rgba(255,255,255,0.1)";
  switch (zone.status) {
    case ZoneStatus.Active: return "#00ff88";
    case ZoneStatus.UnderChallenge: return "#ff6400";
    case ZoneStatus.Dormant: return "#444";
    default: return "rgba(255,255,255,0.1)";
  }
}

export function ZoneHex({ hexId, zone, onPress }: Props) {
  const boundary = h3.cellToBoundary(hexId);
  const coordinates = boundary.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));

  return (
    <Polygon
      coordinates={coordinates}
      fillColor={hexColor(zone)}
      strokeColor={hexStroke(zone)}
      strokeWidth={1}
      tappable
      onPress={onPress}
    />
  );
}
