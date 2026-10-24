// THROWAWAY: copied from the current project fixtures.ts, with a structure-only finish.
// No terrain Cell objects are made here; placement and structure geometry are unchanged.
import type { Cell, Matter, Point, SceneFixture } from '../../hepingmoniqi-v09/src/structural/types.ts';

type MapId = 'lab' | 'neighborhood' | 'city';
type Role = Cell['role'];
interface Building { objectId: string; variant: number; width: number; depth: number; floors: number; x: number; z: number; turns: number }
interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

// Original warm cottage palette and layouts, adapted from warm-voxel-scale-spike.
// All previous 2 × 1 × 2 merged floors are individual authoritative unit cells here.
const materials: Record<Matter, { hp: number; colors: number[] }> = {
  soil: { hp: 3.2, colors: [0x775238, 0x8b6240, 0x9a7048] },
  road: { hp: 4, colors: [0x6f675c, 0x807366, 0x71695f] },
  wood: { hp: 2, colors: [0x996238, 0xae7545, 0xc18a53, 0xb47a47] },
  stone: { hp: 5, colors: [0x626c70, 0x778080, 0x59666b] },
  roof: { hp: 2.4, colors: [0xa94633, 0xbc553d, 0x923b30] },
  glass: { hp: .6, colors: [0x8bc7cf, 0xa9dfe0] },
  foliage: { hp: .7, colors: [0x547436, 0x688b37, 0x7e9b42, 0x94ad4c] },
  metal: { hp: 6, colors: [0x3d4954, 0x515e65] },
};
const variants = [[8, 10, 1], [10, 12, 2], [12, 8, 1], [14, 12, 3], [10, 16, 2], [16, 14, 4], [12, 16, 3], [14, 10, 5], [16, 16, 5]] as const;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const horizontalKey = (x: number, z: number) => `${x},${z}`;
const rotate = (x: number, z: number, turns: number): [number, number] =>
  turns === 1 ? [-z, x] : turns === 2 ? [-x, -z] : turns === 3 ? [z, -x] : [x, z];

function placements(map: MapId): Building[] {
  const result: Building[] = [];
  const put = (variant: number, x: number, z: number, turns: number) => {
    const [width, depth, floors] = variants[variant];
    result.push({ objectId: `warm:${map}:building-${String(result.length + 1).padStart(2, '0')}`, variant, width, depth, floors, x, z, turns });
  };
  if (map === 'lab') { put(0, -8, -3, 0); put(0, 3, -3, 0); }
  else if (map === 'neighborhood') {
    const lots = [[-28, -24], [0, -24], [28, -24], [-28, 0], [28, 0], [-28, 24], [0, 24], [28, 24], [0, 0]];
    lots.forEach(([x, z], i) => put(i, x, z, i % 4));
  } else {
    for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
      const block = row * 3 + column;
      for (let lotRow = 0; lotRow < 2; lotRow++) for (let lotColumn = 0; lotColumn < 3; lotColumn++) {
        put(result.length % 9, (column - 1) * 78 + (lotColumn - 1) * 24,
          (row === 0 ? -34 : 34) + (lotRow === 0 ? -12 : 12), (block + lotRow * 3 + lotColumn) % 4);
      }
    }
  }
  return result;
}

function footprint(building: Building): Rect {
  const corners = [0, building.width - 1].flatMap(x => [0, building.depth - 1].map(z =>
    rotate(x - building.width / 2, z - building.depth / 2, building.turns)));
  return {
    minX: building.x + Math.min(...corners.map(([x]) => x)), maxX: building.x + Math.max(...corners.map(([x]) => x)),
    minZ: building.z + Math.min(...corners.map(([, z]) => z)), maxZ: building.z + Math.max(...corners.map(([, z]) => z)),
  };
}

class FixtureBuilder {
  private cells = new Map<string, Cell>();
  readonly soil = new Map<string, { x: number; z: number }>();
  private roads = new Map<string, { x: number; z: number }>();
  constructor(readonly map: MapId) {}

  put(objectId: string, role: Role, x: number, y: number, z: number, material: Matter, shade = 0): void {
    const k = key(x, y, z);
    if (this.cells.has(k)) throw new Error(`Overlapping fixture cells: ${objectId} and ${this.cells.get(k)!.objectId} at ${k}`);
    const spec = materials[material];
    const color = spec.colors[Math.abs(x * 73 + y * 31 + z * 17 + shade * 13) % spec.colors.length];
    this.cells.set(k, { id: 0, objectId, role, position: { x, y, z }, material, color, hp: spec.hp, maxHp: spec.hp });
  }

  terrain(minX: number, maxX: number, minZ: number, maxZ: number): void {
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) this.soil.set(horizontalKey(x, z), { x, z });
  }

  road(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.terrain(minX - 2, maxX + 2, minZ - 2, maxZ + 2);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) this.roads.set(horizontalKey(x, z), { x, z });
  }

  finish(): SceneFixture & { allocations: { groundCellObjects: number; structureCellObjects: number; uniqueLegacyColumnRecordsAtFinish: number } } {
    // In the source all 3 legacy soil layers sort before y >= 0 structures.
    // Count those historical IDs without ever constructing those soil Cells.
    for (const { x, z } of this.roads.values()) this.put(`warm:${this.map}:road`, 'road', x, 0, z, 'road');
    const cells = [...this.cells.values()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.position.z - b.position.z);
    const start = (this.map === 'lab' ? 1 : this.map === 'neighborhood' ? 1_000_001 : 2_000_001) + this.soil.size * 3;
    cells.forEach((cell, i) => { cell.id = start + i; });
    return { id: `sparse-structure:${this.map}`, cells, allocations: {groundCellObjects: 0, structureCellObjects: cells.length, uniqueLegacyColumnRecordsAtFinish: this.soil.size} };
  }
}

function addBuilding(builder: FixtureBuilder, building: Building): void {
  const { width: w, depth: d, floors } = building;
  const local = new Map<string, { position: Point; material: Matter }>();
  const put = (x: number, y: number, z: number, material: Matter) => local.set(key(x, y, z), { position: { x, y, z }, material });
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    if (x === 1 || x === w - 2 || z === 1 || z === d - 2) put(x, 0, z, 'stone');
  }
  for (let level = 0; level <= floors; level++) for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) put(x, 1 + level * 6, z, 'wood');
  for (let floor = 0; floor < floors; floor++) for (let dy = 1; dy <= 5; dy++) {
    for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
      const onX = x === 1 || x === w - 2, onZ = z === 1 || z === d - 2;
      if (!onX && !onZ) continue;
      if (floor === 0 && z === d - 2 && x >= Math.floor(w / 2) - 1 && x <= Math.floor(w / 2) && dy <= 4) continue;
      const along = onZ ? x : z, span = onZ ? w : d;
      const window = dy >= 2 && dy <= 3 && along >= 3 && along <= span - 4 && (along - 3) % 4 < 2;
      put(x, 1 + floor * 6 + dy, z, window ? 'glass' : 'wood');
    }
  }
  const ceiling = 1 + floors * 6, roofBase = ceiling + 1;
  const roofY = (x: number) => roofBase + Math.floor(Math.min(x, w - 1 - x) / 2);
  for (let x = 0; x < w; x++) {
    const top = roofY(x), adjacentLow = Math.min(roofY(Math.max(0, x - 1)), roofY(Math.min(w - 1, x + 1)));
    for (let z = 0; z < d; z++) {
      put(x, top, z, 'roof');
      if (adjacentLow < top) put(x, top - 1, z, 'roof');
    }
    if (x >= 1 && x <= w - 2) for (const z of [1, d - 2]) for (let y = ceiling + 1; y < top; y++) {
      if (!local.has(key(x, y, z))) put(x, y, z, 'wood');
    }
  }
  if (building.variant % 2 === 0) {
    const x = w - 4, z = 3;
    for (let y = 0; y <= roofY(x) + 2; y++) put(x, y, z, y === roofY(x) + 2 ? 'metal' : 'stone');
  }
  for (const { position: p, material } of local.values()) {
    const [x, z] = rotate(p.x - w / 2, p.z - d / 2, building.turns);
    builder.put(building.objectId, p.y === 0 ? 'foundation' : 'building', building.x + x, p.y, building.z + z, material, building.variant);
  }
}

function addTree(builder: FixtureBuilder, x: number, z: number, index: number): void {
  builder.terrain(x - 2, x + 2, z - 2, z + 2);
  const objectId = `warm:${builder.map}:tree-${String(index).padStart(2, '0')}`;
  for (let y = 0; y <= 5; y++) builder.put(objectId, 'tree', x, y, z, 'wood');
  for (let y = 4; y <= 7; y++) {
    const radius = y === 5 ? 3 : y === 7 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > radius || (dx === 0 && dz === 0 && y <= 5)) continue;
      builder.put(objectId, 'tree', x + dx, y, z + dz, 'foliage', index);
    }
  }
}

function addBridge(builder: FixtureBuilder, x: number, z: number, turns = 0): void {
  const objectId = `warm:${builder.map}:bridge-01`;
  builder.terrain(x - (turns ? 3 : 7), x + (turns ? 3 : 7), z - (turns ? 7 : 3), z + (turns ? 7 : 3));
  const put = (dx: number, y: number, dz: number, material: Matter) => {
    const [rx, rz] = rotate(dx, dz, turns);
    builder.put(objectId, 'bridge', x + rx, y, z + rz, material);
  };
  for (const dx of [-5, 5]) for (let y = 0; y < 4; y++) for (let dz = -1; dz <= 1; dz++) put(dx, y, dz, 'stone');
  for (let dx = -5; dx <= 5; dx++) for (let dz = -1; dz <= 1; dz++) put(dx, 4, dz, 'wood');
  for (let dx = -5; dx <= 5; dx++) for (const dz of [-1, 1]) put(dx, 5, dz, 'metal');
}

/** Structure-only projection of the current source fixture. The historical
 * terrain footprint is counted solely to preserve original positive IDs.
 * Returns no terrain Cells and does not create native physics objects. */
export function sparseStructureFixture(map: MapId) {
  const builder = new FixtureBuilder(map), buildings = placements(map);
  if (map === 'lab') {
    builder.terrain(-20, 21, -15, 13);
    builder.road(-18, 0, 5, 7);
    builder.road(9, 11, 2, 11);
    addTree(builder, -14, 10, 1);
    addBridge(builder, 10, 7);
  } else if (map === 'neighborhood') {
    for (const x of [-14, 14]) builder.road(x - 1, x + 1, -35, 35);
    for (const z of [-12, 12]) builder.road(-38, 38, z - 1, z + 1);
    for (const building of buildings) {
      const rect = footprint(building), street = building.x < 0 ? -14 : 14;
      builder.terrain(rect.minX - 2, rect.maxX + 2, rect.minZ - 2, rect.maxZ + 2);
      builder.terrain(Math.min(building.x, street), Math.max(building.x, street), building.z - 1, building.z + 1);
      if (street > building.x) builder.road(rect.maxX + 1, street, building.z - 1, building.z + 1);
      else builder.road(street, rect.minX - 1, building.z - 1, building.z + 1);
    }
    for (const [i, [x, z]] of [[-19, -6], [19, -6], [-19, 6], [19, 6]].entries()) {
      builder.terrain(Math.min(x, x < 0 ? -14 : 14), Math.max(x, x < 0 ? -14 : 14), z - 1, z + 1);
      addTree(builder, x, z, i + 1);
    }
    addBridge(builder, 14, 20);
  } else {
    for (const z of [-34, 0, 34]) builder.road(-116, 116, z - 1, z + 1);
    for (const x of [-39, 39]) builder.road(x - 1, x + 1, -58, 58);
    for (const building of buildings) {
      const rect = footprint(building), street = building.z < 0 ? -34 : 34;
      builder.terrain(rect.minX - 2, rect.maxX + 2, rect.minZ - 2, rect.maxZ + 2);
      builder.terrain(building.x - 1, building.x + 1, Math.min(building.z, street), Math.max(building.z, street));
      if (street > building.z) builder.road(building.x - 1, building.x + 1, rect.maxZ + 1, street);
      else builder.road(building.x - 1, building.x + 1, street, rect.minZ - 1);
    }
    for (const [i, x] of [-110, -86, -62, -16, 8, 32, 62, 86, 110].entries()) {
      builder.terrain(x - 1, x + 1, 0, 6);
      addTree(builder, x, 6, i + 1);
    }
    addBridge(builder, 0, 0, 1);
  }
  buildings.forEach(building => addBuilding(builder, building));
  return builder.finish();
}
