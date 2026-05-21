import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { COLORS } from '../../constants/design.js';
import { Skeleton } from './Skeleton.js';

const { width: SW, height: SH } = Dimensions.get('window');
const HEX_SIZE = 44; // pointy-top hex circumradius in pixels

function buildHexGridPath(w: number, h: number): ReturnType<typeof Skia.Path.Make> {
  const path = Skia.Path.Make();
  // Pointy-top hex geometry
  const hexW = Math.sqrt(3) * HEX_SIZE;
  const hexH = 2 * HEX_SIZE;
  const colSpacing = hexW;
  const rowSpacing = hexH * 0.75;

  const cols = Math.ceil(w / colSpacing) + 2;
  const rows = Math.ceil(h / rowSpacing) + 2;

  for (let col = -1; col < cols; col++) {
    for (let row = -1; row < rows; row++) {
      const cx = col * colSpacing + (row % 2 === 0 ? 0 : hexW / 2);
      const cy = row * rowSpacing;
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6; // pointy-top
        const x = cx + HEX_SIZE * Math.cos(angle);
        const y = cy + HEX_SIZE * Math.sin(angle);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.close();
    }
  }
  return path;
}

export function MapSkeleton() {
  const hexPath = useMemo(() => buildHexGridPath(SW, SH), []);

  return (
    <View style={styles.container}>
      {/* Dark map background */}
      <View style={styles.mapBg} />

      {/* Faint hex grid drawn with --line color */}
      <Canvas style={StyleSheet.absoluteFill}>
        <Path
          path={hexPath}
          color={COLORS.line}
          style="stroke"
          strokeWidth={1}
        />
      </Canvas>

      {/* Bottom overlay: token balance + track button skeletons */}
      <View style={styles.overlay}>
        <Skeleton width={140} height={58} borderRadius={20} />
        <Skeleton width="100%" height={56} borderRadius={32} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject },
  mapBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0a0f0c' },
  overlay: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    gap: 12,
  },
});
