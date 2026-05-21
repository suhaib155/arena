import React from 'react';
import { Polygon } from 'react-native-maps';
import * as h3 from 'h3-js';
import { Zone, ZoneStatus } from '@movenrun/shared';
import { colors } from '../theme/tokens';

interface Props {
  hexId: string;
  zone: Zone | null;
  onPress: () => void;
  /** True when zoomed in enough to warrant full detail rendering */
  detailed?: boolean;
}

function hexFill(zone: Zone | null): string {
  if (!zone) return 'rgba(255,255,255,0.04)';
  switch (zone.status) {
    case ZoneStatus.Active:         return `${colors.signal}26`;       // 15% opacity
    case ZoneStatus.UnderChallenge: return `${colors.contested}40`;    // 25% opacity
    case ZoneStatus.Dormant:        return 'rgba(100,100,100,0.12)';
    default:                        return 'rgba(255,255,255,0.04)';
  }
}

function hexStroke(zone: Zone | null): string {
  if (!zone) return 'rgba(255,255,255,0.08)';
  switch (zone.status) {
    case ZoneStatus.Active:         return colors.signal;
    case ZoneStatus.UnderChallenge: return colors.contested;
    case ZoneStatus.Dormant:        return colors.surface;
    default:                        return 'rgba(255,255,255,0.08)';
  }
}

function strokeWidth(zone: Zone | null, detailed: boolean): number {
  if (!zone || !detailed) return 1;
  switch (zone.status) {
    case ZoneStatus.Active:         return 1.5;
    case ZoneStatus.UnderChallenge: return 2;
    default:                        return 1;
  }
}

export function ZoneHex({ hexId, zone, onPress, detailed = false }: Props) {
  const boundary = h3.cellToBoundary(hexId);
  const coordinates = boundary.map(([lat, lng]) => ({
    latitude: lat,
    longitude: lng,
  }));

  return (
    <Polygon
      coordinates={coordinates}
      fillColor={hexFill(zone)}
      strokeColor={hexStroke(zone)}
      strokeWidth={strokeWidth(zone, detailed)}
      tappable
      onPress={onPress}
    />
  );
}
