import type { Cell, Point } from './types';

export interface PackedBox {
  id: string;
  center: Point;
  half: Point;
  cellIds: number[];
  chunkKey: string;
}

const positionKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const comparePosition = (a: Point, b: Point) => a.x - b.x || a.y - b.y || a.z - b.z;
function validateChunkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Chunk size must be a positive safe integer');
}

/** Integer chunk coordinates; floor is important on the negative side of zero. */
export function chunkKey(position: Point, chunkSize = 8): string {
  validateChunkSize(chunkSize);
  return positionKey(Math.floor(position.x / chunkSize), Math.floor(position.y / chunkSize), Math.floor(position.z / chunkSize));
}

/**
 * Exact collider representation of authoritative, axis-aligned unit cells.
 * Never changes the cells or their damage/material/ownership data. Every box
 * contains only occupied cells of one material within a fixed spatial chunk.
 *
 * Numeric chunk/seed ordering and fixed X, then Y, then Z growth make both
 * geometry and IDs independent of input order. This is greedy packing, not a
 * minimum-box solver. A local edit can only alter boxes in its own chunk.
 */
export function packStaticCells(cells: readonly Cell[], chunkSize = 8): PackedBox[] {
  validateChunkSize(chunkSize);
  const ids = new Set<number>();
  const chunks = new Map<string, { key: string; position: Point; cells: Cell[]; available: Map<string, Cell> }>();
  for (const cell of cells) {
    const { x, y, z } = cell.position;
    if (![x, y, z].every(Number.isSafeInteger)) throw new Error('Static cells must use safe integer lattice positions');
    if (!Number.isSafeInteger(cell.id) || ids.has(cell.id)) throw new Error(`Invalid or duplicate cell ID: ${cell.id}`);
    ids.add(cell.id);
    const position = { x: Math.floor(x / chunkSize), y: Math.floor(y / chunkSize), z: Math.floor(z / chunkSize) };
    const key = positionKey(position.x, position.y, position.z);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { key, position, cells: [], available: new Map() };
      chunks.set(key, chunk);
    }
    const localKey = positionKey(x, y, z);
    if (chunk.available.has(localKey)) throw new Error(`Overlapping static cell position: ${localKey}`);
    chunk.available.set(localKey, cell);
    chunk.cells.push(cell);
  }

  const boxes: PackedBox[] = [];
  for (const chunk of [...chunks.values()].sort((a, b) => comparePosition(a.position, b.position))) {
    const { available } = chunk;
    for (const start of chunk.cells.sort((a, b) => comparePosition(a.position, b.position))) {
      const { x, y, z } = start.position;
      if (!available.has(positionKey(x, y, z))) continue;
      const same = (px: number, py: number, pz: number) => available.get(positionKey(px, py, pz))?.material === start.material;
      let maxX = x, maxY = y, maxZ = z;
      while (same(maxX + 1, y, z)) maxX++;
      growY: while (true) {
        for (let px = x; px <= maxX; px++) if (!same(px, maxY + 1, z)) break growY;
        maxY++;
      }
      growZ: while (true) {
        for (let px = x; px <= maxX; px++) for (let py = y; py <= maxY; py++)
          if (!same(px, py, maxZ + 1)) break growZ;
        maxZ++;
      }
      const cellIds: number[] = [];
      for (let px = x; px <= maxX; px++) for (let py = y; py <= maxY; py++) for (let pz = z; pz <= maxZ; pz++) {
        const key = positionKey(px, py, pz);
        cellIds.push(available.get(key)!.id);
        available.delete(key);
      }
      cellIds.sort((a, b) => a - b);
      boxes.push({
        id: `static:${chunk.key}:${start.material}:${x},${y},${z}:${maxX},${maxY},${maxZ}`,
        center: { x: x + (maxX - x) / 2, y: y + (maxY - y) / 2, z: z + (maxZ - z) / 2 },
        half: { x: (maxX - x + 1) / 2, y: (maxY - y + 1) / 2, z: (maxZ - z + 1) / 2 },
        cellIds,
        chunkKey: chunk.key,
      });
    }
  }
  return boxes;
}
