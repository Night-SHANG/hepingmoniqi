// THROWAWAY storage-only proof. Not imported by the game. No Rapier/world ownership.
import type { Cell, CellView, Point, Rotation } from '../../src/structural/types.ts';
const materials: Cell['material'][] = ['soil', 'road', 'wood', 'stone', 'roof', 'glass', 'foliage', 'metal'];
const roles: Cell['role'][] = ['terrain', 'road', 'foundation', 'building', 'tree', 'bridge'];
export interface StructureChange { id: number; hp: number; loss: number; state: CellView['state']; position?: Point; rotation?: Rotation; chunkId?: string }
interface MutableRecord extends StructureChange { revision: number }
const finitePoint = (p: Point | undefined): p is Point => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const finiteRotation = (q: Rotation | undefined): q is Rotation => finitePoint(q) && Number.isFinite(q.w);
const offsets = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const;
const int32 = (n: number) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

/** Immutable typed columns, two numeric binary searches, and no retained source Cells.
 * Restricts immutable coordinates/IDs to exact Int32 lattice values. HP remains Float64.
 * Returned CellViews are temporary owned values, never cached per cell.
 */
export class CompactStructures {
  readonly cellCount: number;
  private readonly ids: Int32Array;
  private readonly x: Int32Array;
  private readonly y: Int32Array;
  private readonly z: Int32Array;
  private readonly hp: Float64Array;
  private readonly maxHp: Float64Array;
  private readonly color: Uint32Array;
  private readonly groupIndex: Uint32Array;
  private readonly material: Uint8Array;
  private readonly role: Uint8Array;
  private readonly anchor: Uint8Array;
  private readonly positionOrder: Uint32Array;
  private readonly objectIds: string[] = [];
  private readonly changed = new Map<number, MutableRecord>();
  private revision = 0;
  private resetRevision = 0;

  constructor(source: readonly Cell[]) {
    this.cellCount = source.length;
    this.ids = new Int32Array(source.length); this.x = new Int32Array(source.length);
    this.y = new Int32Array(source.length); this.z = new Int32Array(source.length);
    this.hp = new Float64Array(source.length); this.maxHp = new Float64Array(source.length);
    this.color = new Uint32Array(source.length); this.groupIndex = new Uint32Array(source.length);
    this.material = new Uint8Array(source.length); this.role = new Uint8Array(source.length);
    this.anchor = new Uint8Array(source.length); this.positionOrder = new Uint32Array(source.length);
    // Temporary reference array and one entry per group. Neither survives construction.
    const sorted = [...source].sort((a, b) => a.id - b.id), groups = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i], material = materials.indexOf(c.material), role = roles.indexOf(c.role);
      if (![c.id, c.position.x, c.position.y, c.position.z].every(int32)
        || !Number.isFinite(c.hp) || !Number.isFinite(c.maxHp) || c.hp < 0 || c.hp > c.maxHp
        || !Number.isInteger(c.color) || c.color < 0 || c.color > 0xffffffff
        || typeof c.objectId !== 'string' || material < 0 || role < 0
        || (c.anchor !== undefined && typeof c.anchor !== 'boolean')) throw new Error('Invalid immutable structure cell');
      if (i && c.id === this.ids[i - 1]) throw new Error('Duplicate structure ID');
      this.ids[i] = c.id; this.x[i] = c.position.x; this.y[i] = c.position.y; this.z[i] = c.position.z;
      this.hp[i] = c.hp; this.maxHp[i] = c.maxHp; this.color[i] = c.color;
      this.material[i] = material; this.role[i] = role;
      this.anchor[i] = c.anchor === undefined ? 0 : c.anchor ? 2 : 1;
      let group = groups.get(c.objectId);
      if (group === undefined) { group = this.objectIds.length; groups.set(c.objectId, group); this.objectIds.push(c.objectId); }
      this.groupIndex[i] = group; this.positionOrder[i] = i;
    }
    this.positionOrder.sort((a, b) => this.x[a] - this.x[b] || this.y[a] - this.y[b] || this.z[a] - this.z[b]);
    for (let i = 1; i < this.cellCount; i++) {
      const a = this.positionOrder[i - 1], b = this.positionOrder[i];
      if (this.x[a] === this.x[b] && this.y[a] === this.y[b] && this.z[a] === this.z[b]) throw new Error('Overlapping original structure positions');
    }
  }

  private validIndex(index: number): boolean { return Number.isInteger(index) && index >= 0 && index < this.cellCount; }
  idAtIndex(index: number): number | null { return this.validIndex(index) ? this.ids[index] : null; }
  xAt(index: number): number | null { return this.validIndex(index) ? this.x[index] : null; }
  yAt(index: number): number | null { return this.validIndex(index) ? this.y[index] : null; }
  zAt(index: number): number | null { return this.validIndex(index) ? this.z[index] : null; }
  colorAt(index: number): number | null { return this.validIndex(index) ? this.color[index] : null; }
  materialAt(index: number): Cell['material'] | null { return this.validIndex(index) ? materials[this.material[index]] : null; }
  objectIdAt(index: number): string | null { return this.validIndex(index) ? this.objectIds[this.groupIndex[index]] : null; }
  anchorAt(index: number): boolean | undefined { return this.validIndex(index) && this.anchor[index] ? this.anchor[index] === 2 : undefined; }
  indexOf(id: number): number {
    if (!int32(id)) return -1;
    let lo = 0, hi = this.cellCount;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.ids[mid] < id) lo = mid + 1; else hi = mid; }
    return lo < this.cellCount && this.ids[lo] === id ? lo : -1;
  }
  indexAt(x: number, y: number, z: number): number {
    if (!int32(x) || !int32(y) || !int32(z)) return -1;
    let lo = 0, hi = this.cellCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1, i = this.positionOrder[mid];
      const comparison = this.x[i] - x || this.y[i] - y || this.z[i] - z;
      if (comparison < 0) lo = mid + 1; else hi = mid;
    }
    if (lo === this.cellCount) return -1;
    const i = this.positionOrder[lo];
    return this.x[i] === x && this.y[i] === y && this.z[i] === z ? i : -1;
  }
  idAt(x: number, y: number, z: number): number | null {
    const index = this.indexAt(x, y, z); return index < 0 ? null : this.ids[index];
  }
  cell(id: number): CellView | null {
    const i = this.indexOf(id); if (i < 0) return null;
    const changed = this.changed.get(id);
    return { id, objectId: this.objectIds[this.groupIndex[i]], role: roles[this.role[i]],
      position: changed?.position ? { ...changed.position } : { x: this.x[i], y: this.y[i], z: this.z[i] }, material: materials[this.material[i]],
      color: this.color[i], hp: changed?.hp ?? this.hp[i], maxHp: this.maxHp[i],
      ...(this.anchor[i] ? { anchor: this.anchor[i] === 2 } : {}),
      state: changed?.state ?? 'static', rotation: changed?.rotation ? { ...changed.rotation } : { x: 0, y: 0, z: 0, w: 1 } };
  }
  private writable(i: number): MutableRecord {
    const id = this.ids[i]; let row = this.changed.get(id);
    if (!row) { row = { id, hp: this.hp[i], loss: 0, state: 'static', revision: 0 }; this.changed.set(id, row); }
    return row;
  }
  damage(id: number, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const i = this.indexOf(id); if (i < 0) return 0;
    const hp = this.changed.get(id)?.hp ?? this.hp[i]; if (hp <= 0) return 0;
    const row = this.writable(i), used = Math.min(hp, amount);
    row.hp -= used; row.loss = Math.min(this.hp[i], row.loss + used);
    if (row.hp <= 1e-8) { row.hp = 0; row.state = 'gone'; row.loss = this.hp[i]; delete row.chunkId; }
    row.revision = ++this.revision;
    return used;
  }
  staticAt(x: number, y: number, z: number): number | null {
    const id = this.idAt(x, y, z);
    return id !== null && (this.changed.get(id)?.state ?? 'static') === 'static' ? id : null;
  }
  staticNeighbors(p: Point): number[] {
    const result: number[] = [];
    for (const [dx, dy, dz] of offsets) { const id = this.staticAt(p.x + dx, p.y + dy, p.z + dz); if (id !== null) result.push(id); }
    return result;
  }
  queryStaticSphere(p: Point, radius: number): number[] {
    if (!finitePoint(p) || !Number.isFinite(radius) || radius < 0) return [];
    let lo = 0, hi = this.cellCount;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.x[this.positionOrder[mid]] < p.x - radius) lo = mid + 1; else hi = mid; }
    const result: number[] = [];
    for (let rank = lo; rank < this.cellCount; rank++) {
      const i = this.positionOrder[rank]; if (this.x[i] > p.x + radius) break;
      if ((this.changed.get(this.ids[i])?.state ?? 'static') !== 'static') continue;
      if (Math.hypot(this.x[i] - p.x, this.y[i] - p.y, this.z[i] - p.z) <= radius) result.push(this.ids[i]);
    }
    return result;
  }
  /** Only stores body-derived state. It never creates a body, integrates motion, or resolves impact. */
  promote(id: number, chunkId: string, position: Point, rotation: Rotation, state: 'dynamic' | 'rubble'): void {
    const i = this.indexOf(id);
    if (i < 0 || (this.changed.get(id)?.hp ?? this.hp[i]) <= 0) throw new Error('Cannot promote an absent cell');
    if (!finitePoint(position) || !finiteRotation(rotation) || typeof chunkId !== 'string' || !chunkId
      || (state !== 'dynamic' && state !== 'rubble')) throw new Error('Invalid promoted pose');
    const row = this.writable(i);
    row.position = { ...position }; row.rotation = { ...rotation }; row.chunkId = chunkId;
    row.state = state; row.loss = this.hp[i]; row.revision = ++this.revision;
  }
  changes(): StructureChange[] {
    return [...this.changed.values()].sort((a, b) => a.id - b.id).map(row => ({
      id: row.id, hp: row.hp, loss: row.loss, state: row.state,
      ...(row.position ? { position: { ...row.position }, rotation: { ...row.rotation! } } : {}),
      ...(row.chunkId !== undefined ? { chunkId: row.chunkId } : {}),
    }));
  }
  /** Storage proof only. Not the production body/episode/event/save validator. */
  restoreChanges(rows: readonly StructureChange[]): void {
    if (!Array.isArray(rows)) throw new Error('Invalid sparse changes');
    const replacement = new Map<number, MutableRecord>();
    for (const row of rows) {
      const i = this.indexOf(row?.id), baseHp = i < 0 ? 0 : this.hp[i];
      if (i < 0 || replacement.has(row.id) || !Number.isFinite(row.hp) || row.hp < 0 || row.hp > baseHp
        || !Number.isFinite(row.loss) || row.loss < 0 || row.loss > baseHp
        || !['static', 'dynamic', 'rubble', 'gone'].includes(row.state)) throw new Error('Invalid or duplicate sparse row');
      const pose = row.position !== undefined || row.rotation !== undefined;
      if (pose && (!finitePoint(row.position) || !finiteRotation(row.rotation))) throw new Error('Invalid sparse pose');
      if (row.state === 'static') {
        if (pose || row.chunkId !== undefined || Math.abs(baseHp - row.hp - row.loss) > 1e-8) throw new Error('Invalid static sparse row');
      } else if (row.state === 'gone') {
        if (row.hp !== 0 || row.loss !== baseHp || row.chunkId !== undefined) throw new Error('Invalid gone sparse row');
      } else if (!pose || row.hp <= 0 || row.loss !== baseHp || typeof row.chunkId !== 'string' || !row.chunkId) throw new Error('Invalid detached sparse row');
      replacement.set(row.id, { id: row.id, hp: row.hp, loss: row.loss, state: row.state, revision: this.revision + 1,
        ...(pose ? { position: { ...row.position! }, rotation: { ...row.rotation! } } : {}),
        ...(row.chunkId !== undefined ? { chunkId: row.chunkId } : {}) });
    }
    // Commit only after every row has been validated and deeply copied.
    this.changed.clear(); for (const [id, row] of replacement) this.changed.set(id, row);
    this.resetRevision = ++this.revision;
  }
  /** Sparse latest-ID notifications, not a full retained CellView/history cache.
   * A reset means re-enumerate the immutable ID inventory and fetch current cells.
   */
  dirtySince(revision: number): { revision: number; reset: boolean; ids: number[] } {
    const reset = !Number.isSafeInteger(revision) || revision < this.resetRevision || revision > this.revision;
    return { revision: this.revision, reset, ids: reset ? [] : [...this.changed.values()].filter(row => row.revision > revision).map(row => row.id).sort((a, b) => a - b) };
  }
  diagnostics() {
    const typedBytes = [this.ids, this.x, this.y, this.z, this.hp, this.maxHp, this.color, this.groupIndex,
      this.material, this.role, this.anchor, this.positionOrder].reduce((sum, a) => sum + a.byteLength, 0);
    return { cellCount: this.cellCount, changedCells: this.changed.size, poseRecords: [...this.changed.values()].filter(row => !!row.position).length, internedObjectIds: this.objectIds.length,
      retainedCellObjects: 0, positionStringMapEntries: 0, typedBytes };
  }
}
