import { latLngToCell, cellToParent, cellToChildren } from "h3-js";

/** Converts an h3-js cell string into the uint64 token id MovenRunDeed uses. */
export function toCellId(cell: string): bigint {
  return BigInt(`0x${cell}`);
}

export function cellAt(lat: number, lng: number, resolution = 8): bigint {
  return toCellId(latLngToCell(lat, lng, resolution));
}

export function parentOf(lat: number, lng: number, resolution: number): bigint {
  return toCellId(cellToParent(latLngToCell(lat, lng, 8), resolution));
}

export function childOf(lat: number, lng: number, resolution: number): bigint {
  return toCellId(cellToChildren(latLngToCell(lat, lng, 8), resolution)[0]);
}

/** Distinct resolution-8 cells inside one city, for concentration testing. */
export function cityCells(count: number, lat = 12.9716, lng = 77.5946): bigint[] {
  const cells = new Set<string>();
  let step = 0;
  while (cells.size < count) {
    cells.add(latLngToCell(lat + step * 0.02, lng + step * 0.017, 8));
    step += 1;
    if (step > count * 50) throw new Error("could not find enough distinct cells");
  }
  return [...cells].map(toCellId);
}
