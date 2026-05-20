import React, { useEffect, useRef, memo } from "react";
import { Animated } from "react-native";
import { Polygon } from "react-native-maps";
import * as h3 from "h3-js";
import { Zone, ZoneStatus } from "@movenrun/shared";

interface Props {
  hexId: string;
  zone: Zone | null;
  walletAddress: string | null;
  ownedByUser: boolean;
  onPress: () => void;
}

interface FillStroke {
  fill: string;
  stroke: string;
  isContested: boolean;
}

function resolveStyle(zone: Zone | null, ownedByUser: boolean): FillStroke {
  if (!zone || zone.status === ZoneStatus.Unminted) {
    // Unminted but active (visited by anyone): semi-transparent blue
    return {
      fill: "rgba(59,130,246,0.2)",
      stroke: "rgba(59,130,246,0.35)",
      isContested: false,
    };
  }
  if (zone.status === ZoneStatus.UnderChallenge) {
    return {
      fill: "rgba(249,115,22,0.5)",
      stroke: "rgba(249,115,22,0.8)",
      isContested: true,
    };
  }
  if (zone.status === ZoneStatus.Dormant) {
    // Grey — diagonal stripes can't be done with Polygon, use lighter fill
    return {
      fill: "rgba(156,163,175,0.15)",
      stroke: "rgba(156,163,175,0.25)",
      isContested: false,
    };
  }
  // Active zone
  if (ownedByUser) {
    return {
      fill: "rgba(37,99,235,0.4)",
      stroke: "#2563EB",
      isContested: false,
    };
  }
  return {
    fill: "rgba(156,163,175,0.3)",
    stroke: "rgba(156,163,175,0.45)",
    isContested: false,
  };
}

export const ZoneHex = memo(function ZoneHex({
  hexId,
  zone,
  walletAddress: _walletAddress,
  ownedByUser,
  onPress,
}: Props) {
  const boundary = h3.cellToBoundary(hexId);
  const coordinates = boundary.map(([lat, lng]) => ({
    latitude: lat,
    longitude: lng,
  }));

  const { fill, stroke, isContested } = resolveStyle(zone, ownedByUser);

  // Pulse animation for contested hexes
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isContested) {
      pulseOpacity.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [isContested, pulseOpacity]);

  // react-native-maps Polygon doesn't accept Animated values; we cycle the
  // fill string state instead for the pulse effect.
  const [fillColor, setFillColor] = React.useState(fill);
  useEffect(() => {
    if (!isContested) {
      setFillColor(fill);
      return;
    }
    let high = true;
    const id = setInterval(() => {
      setFillColor(
        high ? "rgba(249,115,22,0.5)" : "rgba(249,115,22,0.25)",
      );
      high = !high;
    }, 900);
    return () => clearInterval(id);
  }, [isContested, fill]);

  return (
    <Polygon
      coordinates={coordinates}
      fillColor={fillColor}
      strokeColor={stroke}
      strokeWidth={1}
      tappable
      onPress={onPress}
    />
  );
});
