import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createStructuralFixture } from './fixtures';
import { chunkKey, packStaticCells, type PackedBox } from './static-packing';
import type { Cell, Point } from './types';

const key = ({ x, y, z }: Point) => `${x},${y},${z}`;
const cell = (id: number, x: number, y: number, z: number, options: Partial<Cell> = {}): Cell => ({
  id, objectId: 'object', role: 'building', position: { x, y, z }, material: 'stone',
  color: 0xffffff, hp: 10, maxHp: 10, ...options,
});
function block(min: Point, size: Point): Cell[] {
  const cells: Cell[] = [];
  for (let x = min.x; x < min.x + size.x; x++)
    for (let y = min.y; y < min.y + size.y; y++)
      for (let z = min.z; z < min.z + size.z; z++) cells.push(cell(cells.length + 1, x, y, z));
  return cells;
}

/** Expand actual collision geometry independently, not via the packer's helpers. */
function assertExact(cells: readonly Cell[], boxes: readonly PackedBox[], chunkSize = 8): Set<string> {
  const expected = new Map(cells.map(c => [key(c.position), c]));
  const byId = new Map(cells.map(c => [c.id, c]));
  const occupied = new Set<string>(), ids = new Set<number>(), boxIds = new Set<string>();
  let volume = 0;
  for (const box of boxes) {
    assert.ok(!boxIds.has(box.id), 'box IDs must be unique'); boxIds.add(box.id);
    const min = { x: box.center.x - box.half.x + .5, y: box.center.y - box.half.y + .5, z: box.center.z - box.half.z + .5 };
    const max = { x: box.center.x + box.half.x - .5, y: box.center.y + box.half.y - .5, z: box.center.z + box.half.z - .5 };
    assert.ok(Object.values(min).every(Number.isInteger) && Object.values(max).every(Number.isInteger));
    assert.ok(Object.values(box.half).every(v => v > 0));
    const members = new Set(box.cellIds);
    assert.equal(members.size, box.cellIds.length, 'a cell ID cannot repeat inside a box');
    assert.deepEqual(box.cellIds, [...box.cellIds].sort((a, b) => a - b));
    const first = byId.get(box.cellIds[0]);
    assert.ok(first, 'each box has known authoritative cell IDs');
    let count = 0;
    for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
      const position = key({ x, y, z }), source = expected.get(position);
      assert.ok(source, `collision must not fill empty air at ${position}`);
      assert.ok(!occupied.has(position), `collision boxes must not overlap at ${position}`);
      assert.ok(members.has(source.id), `geometry and cellIds must agree at ${position}`);
      assert.equal(source.material, first.material, 'a box cannot span material boundaries');
      assert.equal(box.chunkKey, `${Math.floor(x / chunkSize)},${Math.floor(y / chunkSize)},${Math.floor(z / chunkSize)}`);
      occupied.add(position); count++;
    }
    assert.equal(count, box.cellIds.length);
    volume += 8 * box.half.x * box.half.y * box.half.z;
    for (const id of box.cellIds) { assert.ok(!ids.has(id), 'each authoritative cell appears once'); ids.add(id); }
  }
  assert.equal(volume, cells.length, 'occupied collision volume equals authoritative unit-cell volume');
  assert.equal(occupied.size, expected.size);
  assert.deepEqual([...ids].sort((a, b) => a - b), cells.map(c => c.id).sort((a, b) => a - b));
  return occupied;
}

test('a solid unit-cell cuboid packs to one exact box, retaining every authoritative ID', () => {
  const cells = block({ x: 1, y: 2, z: 3 }, { x: 2, y: 3, z: 4 });
  const boxes = packStaticCells(cells);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0].center, { x: 1.5, y: 3, z: 4.5 });
  assert.deepEqual(boxes[0].half, { x: 1, y: 1.5, z: 2 });
  assertExact(cells, boxes);
});

test('empty input has no collision boxes', () => {
  assert.deepEqual(packStaticCells([]), []);
});

test('tunnels and enclosed missing cells remain empty, not bounding-box-filled', () => {
  const cells = block({ x: 0, y: 0, z: 0 }, { x: 7, y: 5, z: 5 }).filter(c =>
    !(c.position.y === 1 && c.position.z === 1) && !(c.position.x === 3 && c.position.y === 3 && c.position.z === 3));
  const occupied = assertExact(cells, packStaticCells(cells));
  for (let x = 0; x < 7; x++) assert.ok(!occupied.has(`${x},1,1`));
  assert.ok(!occupied.has('3,3,3'));
});

test('bridge deck and piers do not fill their underpass', () => {
  const cells = block({ x: 0, y: 0, z: 0 }, { x: 7, y: 5, z: 3 }).filter(c =>
    c.position.y === 4 || c.position.x === 0 || c.position.x === 6);
  const occupied = assertExact(cells, packStaticCells(cells));
  for (let x = 1; x < 6; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++)
    assert.ok(!occupied.has(`${x},${y},${z}`));
});

test('material boundaries split boxes but color, object, role and hp do not simplify the cells', () => {
  const cells = [
    cell(50, 0, 0, 0, { material: 'wood', objectId: 'a', color: 1, hp: 3 }),
    cell(10, 1, 0, 0, { material: 'wood', objectId: 'b', role: 'tree', color: 2, hp: 7 }),
    cell(20, 2, 0, 0, { material: 'stone' }), cell(30, 3, 0, 0, { material: 'stone' }),
  ];
  const before = structuredClone(cells);
  for (const c of cells) { Object.freeze(c.position); Object.freeze(c); }
  const boxes = packStaticCells(Object.freeze(cells));
  assert.equal(boxes.length, 2);
  assertExact(cells, boxes);
  assert.deepEqual(boxes.map(b => b.cellIds), [[10, 50], [20, 30]]);
  assert.deepEqual(cells, before, 'packing never changes damage, appearance, ownership or positions');
});

test('negative positions use floor chunk coordinates on every axis', () => {
  for (const [position, expected] of [
    [{ x: -1, y: -8, z: -9 }, '-1,-1,-2'],
    [{ x: 0, y: 7, z: 8 }, '0,0,1'],
    [{ x: -16, y: -17, z: 16 }, '-2,-3,2'],
  ] as const) assert.equal(chunkKey(position), expected);
  const cells = block({ x: -9, y: -1, z: -1 }, { x: 10, y: 2, z: 2 });
  const boxes = packStaticCells(cells);
  assert.equal(boxes.length, 12);
  assertExact(cells, boxes);
});

test('custom positive integer chunk size limits boxes without losing occupied volume', () => {
  const cells = block({ x: -1, y: 0, z: 0 }, { x: 6, y: 2, z: 2 });
  assert.equal(chunkKey({ x: -1, y: 4, z: 1 }, 2), '-1,2,0');
  const boxes = packStaticCells(cells, 2);
  assert.equal(boxes.length, 4);
  assertExact(cells, boxes, 2);
});

test('input order cannot change box ordering, IDs, geometry or member ordering', () => {
  const cells = block({ x: -9, y: -2, z: 6 }, { x: 19, y: 4, z: 5 })
    .filter(c => (c.id % 11) !== 0).map(c => ({ ...c, material: c.id % 3 === 0 ? 'wood' as const : 'stone' as const }));
  const expected = packStaticCells(cells);
  const shuffled = [...cells].sort((a, b) => ((a.id * 71) % 419) - ((b.id * 71) % 419) || b.id - a.id);
  assert.deepEqual(packStaticCells([...cells].reverse()), expected);
  assert.deepEqual(packStaticCells(shuffled), expected);
  assertExact(cells, expected);
});

test('removing a middle cell changes only its own chunk boxes and leaves its hole empty', () => {
  const cells = block({ x: -8, y: 0, z: 0 }, { x: 24, y: 3, z: 3 });
  const before = packStaticCells(cells);
  const remaining = cells.filter(c => !(c.position.x === 3 && c.position.y === 1 && c.position.z === 1));
  const after = packStaticCells(remaining);
  assert.deepEqual(after.filter(b => b.chunkKey !== '0,0,0'), before.filter(b => b.chunkKey !== '0,0,0'));
  assert.notDeepEqual(after.filter(b => b.chunkKey === '0,0,0'), before.filter(b => b.chunkKey === '0,0,0'));
  assert.ok(!assertExact(remaining, after).has('3,1,1'));
});

test('invalid lattice input is rejected rather than silently dropping authoritative cells', () => {
  for (const size of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => packStaticCells([], size), /chunk size/i);
    assert.throws(() => chunkKey({ x: 0, y: 0, z: 0 }, size), /chunk size/i);
  }
  for (const x of [.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => packStaticCells([cell(1, x, 0, 0)]), /integer|lattice/i);
  assert.throws(() => packStaticCells([cell(1, 0, 0, 0), cell(2, 0, 0, 0)]), /position|overlap/i);
  assert.throws(() => packStaticCells([cell(1, 0, 0, 0), cell(1, 1, 0, 0)]), /id/i);
});

for (const [map, buildings] of [['neighborhood', 9], ['city', 36]] as const) {
  test(`${map}: exact collision volume for the real ${buildings}-building fixture`, t => {
    const { cells } = createStructuralFixture(map);
    const start = performance.now();
    const boxes = packStaticCells(cells);
    const elapsed = performance.now() - start;
    assertExact(cells, boxes);
    assert.ok(boxes.length < cells.length / 4, 'real fixture should substantially reduce static collider count');
    t.diagnostic(`${buildings} buildings: ${cells.length} cells -> ${boxes.length} exact boxes; packing-only ${elapsed.toFixed(2)} ms (not integrated physics performance)`);
  });
}
