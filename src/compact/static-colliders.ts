import RAPIER from '@dimforge/rapier3d-compat';
import { chunkKey, packStaticCells } from '../structural/static-packing.js';
import type { Cell, Matter, Point } from '../structural/types.js';

export interface CompactStaticBounds {
  readonly minX: number; readonly maxX: number;
  readonly minY: number; readonly maxY: number;
  readonly minZ: number; readonly maxZ: number;
}

/** Scalar authority access. No full Cell[], CellView[], or per-cell collider map. */
export interface CompactStaticSource {
  readonly fixture: {
    readonly bounds: CompactStaticBounds;
    originalPosition(id: number): Readonly<Point> | undefined;
    forEachChunk(size: number, visit: (cx: number, cy: number, cz: number) => void): void;
  };
  staticIdAt(x: number, y: number, z: number): number | null;
  materialOf(id: number): Matter | undefined;
}

export interface CompactCollisionRegion {
  readonly handle: number;
  readonly chunkKey: string;
  readonly min: Readonly<Point>;
  readonly max: Readonly<Point>;
  readonly material: Matter;
  readonly mass: number;
}
interface ChunkRegion { readonly key: string; readonly min: Point; readonly max: Point; handles: number[] }
interface BoxGeometry { min: Point; max: Point; material: Matter }
const SIZE = 8;
const MASS: Readonly<Record<Matter, number>> = Object.freeze({ soil: 5, road: 6, wood: 2, stone: 8, roof: 3, glass: 1, foliage: .6, metal: 10 });
const finiteLattice = (p: Readonly<Point>) => [p.x, p.y, p.z].every(Number.isSafeInteger);
const contains = (p: Readonly<Point>, min: Readonly<Point>, max: Readonly<Point>) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;

/** Exact finite static geometry in the simulation's existing Rapier World.
 *
 * Retains only chunk regions and box metadata, never PackedBox.cellIds or a
 * cell-to-collider map. Uniform chunks allocate no Cell objects. Other chunks
 * use at most 8³ transient Cells with the existing deterministic X/Y/Z packer.
 * Dynamic bodies and rubble remain exclusively owned by the simulation.
 *
 * The owner marks ORIGINAL coordinates when static occupancy changes and calls
 * flush before its next world query/step. HP-only damage needs no invalidation.
 * This class never initializes, steps, replaces, or frees the caller's world.
 */
export class CompactStaticColliders {
  readonly bounds: CompactStaticBounds;
  private readonly chunks = new Map<string, ChunkRegion>();
  private readonly boxes = new Map<number, CompactCollisionRegion>();
  private readonly dirty = new Set<string>();
  private disposed = false;
  private temporaryCells = 0;
  private peakTemporaryCells = 0;
  private repackedChunks = 0;

  constructor(private readonly world: RAPIER.World, private readonly source: CompactStaticSource) {
    const b = source.fixture.bounds;
    const empty = b.minX > b.maxX && b.minY > b.maxY && b.minZ > b.maxZ;
    if (![b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].every(Number.isSafeInteger) || !empty && (b.minX > b.maxX || b.minY > b.maxY || b.minZ > b.maxZ)) throw new Error('Invalid finite static bounds');
    this.bounds = Object.freeze({ ...b });
    try {
      source.fixture.forEachChunk(SIZE, (cx, cy, cz) => {
        if (![cx, cy, cz].every(Number.isSafeInteger)) throw new Error('Invalid static chunk coordinate');
        const key = `${cx},${cy},${cz}`;
        if (this.chunks.has(key)) return;
        const min = { x: Math.max(b.minX, cx * SIZE), y: Math.max(b.minY, cy * SIZE), z: Math.max(b.minZ, cz * SIZE) };
        const max = { x: Math.min(b.maxX, cx * SIZE + SIZE - 1), y: Math.min(b.maxY, cy * SIZE + SIZE - 1), z: Math.min(b.maxZ, cz * SIZE + SIZE - 1) };
        if (min.x > max.x || min.y > max.y || min.z > max.z) throw new Error('Static chunk outside fixture bounds');
        const chunk = { key, min, max, handles: [] as number[] };
        this.chunks.set(key, chunk);
        for (const box of this.pack(chunk)) this.add(chunk, box);
      });
    } catch (error) { this.dispose(); throw error; }
  }

  private pack(chunk: ChunkRegion): BoxGeometry[] {
    const { min, max } = chunk;
    let count = 0, uniform = true, material: Matter | undefined;
    for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
      const id = this.source.staticIdAt(x, y, z);
      if (id === null) continue;
      const current = this.source.materialOf(id);
      if (!Number.isSafeInteger(id) || current === undefined || !Object.hasOwn(MASS, current)) throw new Error('Invalid static cell metadata');
      if (count === 0) material = current;
      else if (material !== current) uniform = false;
      count++;
    }
    if (count === 0) return [];
    if (uniform && count === (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1)) return [{ min, max, material: material! }];
    const cells: Cell[] = [];
    for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
      const id = this.source.staticIdAt(x, y, z);
      if (id !== null) cells.push({ id, position: { x, y, z }, material: this.source.materialOf(id)!, hp: 1, maxHp: 1, objectId: '', role: 'terrain', color: 0 });
    }
    this.temporaryCells += cells.length;
    this.peakTemporaryCells = Math.max(this.peakTemporaryCells, cells.length);
    return packStaticCells(cells, SIZE).map(box => {
      const min = { x: box.center.x - box.half.x + .5, y: box.center.y - box.half.y + .5, z: box.center.z - box.half.z + .5 };
      const max = { x: box.center.x + box.half.x - .5, y: box.center.y + box.half.y - .5, z: box.center.z + box.half.z - .5 };
      return { min, max, material: this.source.materialOf(this.source.staticIdAt(min.x, min.y, min.z)!)! };
    });
  }

  private add(chunk: ChunkRegion, box: BoxGeometry): void {
    const { min, max, material } = box;
    const sx = max.x - min.x + 1, sy = max.y - min.y + 1, sz = max.z - min.z + 1;
    const mass = MASS[material] * sx * sy * sz;
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
      .setMass(mass).setFriction(.85).setRestitution(.02)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0));
    this.boxes.set(collider.handle, Object.freeze({ handle: collider.handle, chunkKey: chunk.key, min: Object.freeze({ ...min }), max: Object.freeze({ ...max }), material, mass }));
    chunk.handles.push(collider.handle);
  }

  /** Invalid/out-of-fixture coordinates do not enqueue work. */
  markDirtyAt(originalPosition: Readonly<Point>): boolean {
    if (this.disposed || !finiteLattice(originalPosition)) return false;
    const key = chunkKey(originalPosition, SIZE), chunk = this.chunks.get(key);
    if (!chunk || !contains(originalPosition, chunk.min, chunk.max)) return false;
    this.dirty.add(key); return true;
  }

  /** Returns whether geometry changed, so the owner can refresh its queries. */
  flush(): boolean {
    if (this.disposed || this.dirty.size === 0) return false;
    for (const key of this.dirty) {
      const chunk = this.chunks.get(key)!;
      // Compute first: invalid source data must not remove existing geometry.
      const next = this.pack(chunk);
      this.remove(chunk);
      for (const box of next) this.add(chunk, box);
      this.repackedChunks++;
      this.dirty.delete(key);
    }
    return true;
  }

  private remove(chunk: ChunkRegion): void {
    for (const handle of chunk.handles) {
      const collider = this.world.getCollider(handle);
      if (collider) this.world.removeCollider(collider, true);
      this.boxes.delete(handle);
    }
    chunk.handles = [];
  }

  /** Actual contact position selects a cell inside this box, then live authority
   * rejects removed/promoted cells even before the dirty chunk is rebuilt. */
  resolveCollider(handle: number, at?: Readonly<Point>): number | null {
    const box = this.boxes.get(handle);
    if (!box || !at || ![at.x, at.y, at.z].every(Number.isFinite) || !this.world.getCollider(handle)) return null;
    // Simulation shifts solver contacts 2% toward the dynamic cell center.
    // Permit that contact skin without changing any physical box geometry.
    for (const axis of ['x', 'y', 'z'] as const) if (at[axis] < box.min[axis] - .55 || at[axis] > box.max[axis] + .55) return null;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
    return this.source.staticIdAt(clamp(at.x, box.min.x, box.max.x), clamp(at.y, box.min.y, box.max.y), clamp(at.z, box.min.z, box.max.z));
  }

  /** Bounded search in one 8³ chunk; no retained alias per authoritative cell. */
  colliderForCell(id: number): RAPIER.Collider | undefined {
    if (this.disposed || !Number.isSafeInteger(id)) return undefined;
    const p = this.source.fixture.originalPosition(id);
    if (!p || this.source.staticIdAt(p.x, p.y, p.z) !== id) return undefined;
    const chunk = this.chunks.get(chunkKey(p, SIZE));
    if (!chunk) return undefined;
    for (const handle of chunk.handles) {
      const box = this.boxes.get(handle)!;
      if (contains(p, box.min, box.max)) return this.world.getCollider(handle) ?? undefined;
    }
    return undefined;
  }

  /** Ownership is per native packed box, never a per-cell alias. */
  owns(handle: number): boolean { return !this.disposed && this.boxes.has(handle); }

  /** Query-only broad candidates for a stale native BVH. Clip infinite ray
   * bounds to the finite fixture, visit local chunks, and include touching
   * half-cell boundaries on both sides. Exact tests remain native Collider
   * queries; this iterator never creates, moves or steps physics objects. */
  *collidersInBounds(bounds: CompactStaticBounds): IterableIterator<RAPIER.Collider> {
    if (this.disposed || Object.values(bounds).some(Number.isNaN)
      || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY || bounds.minZ > bounds.maxZ) return;
    const b = this.bounds;
    const minX = Math.max(Math.floor(b.minX / SIZE), Math.floor((bounds.minX - .5) / SIZE));
    const maxX = Math.min(Math.floor(b.maxX / SIZE), Math.floor((bounds.maxX + .5) / SIZE));
    const minY = Math.max(Math.floor(b.minY / SIZE), Math.floor((bounds.minY - .5) / SIZE));
    const maxY = Math.min(Math.floor(b.maxY / SIZE), Math.floor((bounds.maxY + .5) / SIZE));
    const minZ = Math.max(Math.floor(b.minZ / SIZE), Math.floor((bounds.minZ - .5) / SIZE));
    const maxZ = Math.min(Math.floor(b.maxZ / SIZE), Math.floor((bounds.maxZ + .5) / SIZE));
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      const chunk = this.chunks.get(`${x},${y},${z}`); if (!chunk) continue;
      for (const handle of chunk.handles) {
        const box = this.boxes.get(handle)!;
        if (box.max.x + .5 < bounds.minX || box.min.x - .5 > bounds.maxX
          || box.max.y + .5 < bounds.minY || box.min.y - .5 > bounds.maxY
          || box.max.z + .5 < bounds.minZ || box.min.z - .5 > bounds.maxZ) continue;
        const collider = this.world.getCollider(handle); if (collider) yield collider;
      }
    }
  }

  regions(): readonly CompactCollisionRegion[] { return Object.freeze([...this.boxes.values()]); }
  diagnostics() {
    return { chunkCount: this.chunks.size, colliderCount: this.boxes.size, temporaryCells: this.temporaryCells, peakTemporaryCells: this.peakTemporaryCells, retainedCellIds: 0, dirtyChunks: this.dirty.size, repackedChunks: this.repackedChunks };
  }
  dispose(): void {
    if (this.disposed) return;
    for (const chunk of this.chunks.values()) this.remove(chunk);
    this.chunks.clear(); this.dirty.clear(); this.disposed = true;
  }
}
