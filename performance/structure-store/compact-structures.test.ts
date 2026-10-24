import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactStructures } from './compact-structures.ts';
import { sparseStructureFixture } from '../support-ab/sparse-structure-fixture.ts';
import type { Cell, CellView } from '../../src/structural/types.ts';
const identity = { x: 0, y: 0, z: 0, w: 1 };
const view = (c: Cell): CellView => ({ ...structuredClone(c), state: 'static', rotation: { ...identity } });
const sample = (id: number, x: number, overrides: Partial<Cell> = {}): Cell => ({ id, objectId: 'house', role: 'building', position: { x, y: 1, z: 0 }, material: 'roof', color: 0xa94633, hp: 2.4, maxHp: 2.4, ...overrides });

test('all 53113 city cells reconstruct every exact field and stable original ID without ground allocation', () => {
  const source = sparseStructureFixture('city');
  const model = new CompactStructures(source.cells);
  assert.equal(model.cellCount, 53113);
  assert.equal(source.allocations.groundCellObjects, 0);
  assert.equal(new Set(source.cells.filter(c => c.role === 'building').map(c => c.objectId)).size, 36);
  for (const c of source.cells) {
    assert.deepEqual(model.cell(c.id), view(c));
    assert.equal(model.idAt(c.position.x, c.position.y, c.position.z), c.id);
  }
  assert.equal(model.cell(source.cells[0].id - 1), null);
  assert.equal(model.cell(0.1), null);
  assert.equal(model.idAt(1e9, 0, 0), null);
  assert.equal(model.idAt(.1, 1, 0), null);
  const d = model.diagnostics();
  assert.equal(d.changedCells, 0); assert.equal(d.poseRecords, 0);
  assert.equal(d.internedObjectIds, 47);
  assert.equal(d.retainedCellObjects, 0); assert.equal(d.positionStringMapEntries, 0);
  assert.equal(d.typedBytes, 53113 * 47);
});

test('source and returned snapshots are deep-owned, including optional anchors and double HP', () => {
  const source = [sample(99, -5, { anchor: false }), sample(-9, 4, { anchor: true }), sample(1234, 12)];
  const expected = source.map(view), model = new CompactStructures(source);
  source[0].position.x = 800; source[0].hp = 0; source[0].objectId = 'changed'; source.reverse(); source.length = 0;
  for (const c of expected) assert.deepEqual(model.cell(c.id), c);
  const returned = model.cell(99)!; returned.position.z = 70; returned.rotation.w = 0; returned.hp = 0;
  assert.deepEqual(model.cell(99), expected[0]);
  assert.equal(model.idAt(-5, 1, 0), 99);
  assert.equal(model.idAt(0, 1, -5), null);
});

test('invalid typed-domain inputs, duplicate IDs and overlapping original positions are rejected', () => {
  for (const source of [
    [sample(1, 0), sample(1, 2)], [sample(1, 0), sample(2, 0)],
    [sample(1, .5)], [sample(2 ** 31, 0)], [sample(1, 2 ** 31)],
    [sample(1, 0, { hp: NaN })], [sample(1, 0, { maxHp: 1 })],
    [sample(1, 0, { color: -1 })],
  ]) assert.throws(() => new CompactStructures(source), /invalid|duplicate|overlap/i);
  const empty = new CompactStructures([]); assert.equal(empty.cellCount, 0); assert.equal(empty.cell(1), null);
});

test('repeated fractional damage matches JS doubles and cumulative loss, without pose allocations', () => {
  const source = [sample(1, 0, { hp: 5, maxHp: 5 }), sample(2, 1)], model = new CompactStructures(source);
  let hp = 5, loss = 0;
  for (let i = 0; i < 60; i++) {
    const used = Math.min(hp, 1 / 13); hp -= used; loss = Math.min(5, loss + used);
    if (hp <= 1e-8) { hp = 0; loss = 5; }
    assert.equal(model.damage(1, 1 / 13), used);
    assert.equal(model.cell(1)!.hp, hp);
    assert.equal(model.changes()[0].loss, loss);
  }
  assert.equal(model.diagnostics().changedCells, 1); assert.equal(model.diagnostics().poseRecords, 0);
  const before = model.dirtySince(0);
  for (const amount of [0, -1, NaN, Infinity]) assert.equal(model.damage(1, amount), 0);
  assert.equal(model.damage(999, 1), 0);
  assert.deepEqual(model.dirtySince(0), before);
  assert.equal(model.damage(1, 100), hp); assert.equal(model.cell(1)!.state, 'gone');
  assert.equal(model.cell(1)!.hp, 0); assert.equal(model.staticAt(0, 1, 0), null);
  assert.equal(model.damage(1, 100), 0);
  assert.equal(model.idAt(0, 1, 0), 1, 'identity lookup survives departure');
  const edge = new CompactStructures([sample(3, 0)]);
  edge.damage(3, 2.4 - 5e-9); assert.equal(edge.cell(3)!.state, 'gone');
});

test('dirty IDs are deduplicated for independent cursors and mutation-safe, with explicit restore reset', () => {
  const model = new CompactStructures([sample(1, 0), sample(2, 1), sample(3, 2)]);
  assert.deepEqual(model.dirtySince(0), { revision: 0, reset: false, ids: [] });
  model.damage(2, .1); const cursorA = model.dirtySince(0);
  assert.deepEqual(cursorA, { revision: 1, reset: false, ids: [2] });
  model.damage(2, .2); model.damage(1, .25);
  assert.deepEqual(model.dirtySince(0), { revision: 3, reset: false, ids: [1, 2] });
  assert.deepEqual(model.dirtySince(cursorA.revision), { revision: 3, reset: false, ids: [1, 2] });
  assert.deepEqual(cursorA, { revision: 1, reset: false, ids: [2] });
  const exported = model.dirtySince(0); exported.ids.push(9);
  assert.deepEqual(model.dirtySince(3), { revision: 3, reset: false, ids: [] });
  for (const cursor of [-1, 4, NaN, .5]) assert.equal(model.dirtySince(cursor).reset, true);
  model.restoreChanges([]);
  assert.deepEqual(model.dirtySince(3), { revision: 4, reset: true, ids: [] });
  assert.deepEqual(model.dirtySince(4), { revision: 4, reset: false, ids: [] });
  assert.equal(model.cell(2)!.hp, 2.4); assert.equal(model.diagnostics().changedCells, 0);
});

test('promotion/rubble pose remains deeply owned, vacates lattice, and keeps exact identity and HP', () => {
  const model = new CompactStructures([sample(9, 0), sample(10, 1)]);
  model.damage(9, .125); const before = model.cell(9)!;
  const position = { x: 11.25, y: -2.5, z: 6 }, rotation = { x: .1, y: .2, z: .3, w: .9 };
  model.promote(9, 'piece-1', position, rotation, 'dynamic');
  position.x = 999; rotation.w = 0;
  assert.deepEqual(model.cell(9), { ...before, position: { x: 11.25, y: -2.5, z: 6 }, rotation: { x: .1, y: .2, z: .3, w: .9 }, state: 'dynamic' });
  assert.equal(model.staticAt(0, 1, 0), null); assert.equal(model.staticAt(11.25, -2.5, 6), null);
  assert.equal(model.diagnostics().poseRecords, 1); assert.equal(model.changes()[0].loss, 2.4);
  model.promote(9, 'piece-1', { x: 11.25, y: -.5, z: 6 }, identity, 'rubble');
  assert.equal(model.cell(9)!.hp, before.hp); assert.equal(model.cell(9)!.state, 'rubble');
  model.damage(9, 100);
  assert.equal(model.cell(9)!.state, 'gone'); assert.equal(model.changes()[0].chunkId, undefined);
  assert.equal(model.staticAt(0, 1, 0), null);
  assert.throws(() => model.promote(9, 'piece-2', { x: 0, y: 0, z: 0 }, identity, 'dynamic'));
});

test('numeric static neighbors and bounded sphere queries match dense occupancy after sparse edits', () => {
  const source: Cell[] = [];
  for (let x = -4; x <= 4; x++) for (let y = 0; y <= 3; y++) for (let z = -2; z <= 2; z++)
    if ((x + y + z) % 3) source.push(sample(100 + source.length * 7, x, { position: { x, y, z } }));
  const model = new CompactStructures(source), live = new Set(source.map(c => c.id));
  for (const [i, c] of source.entries()) {
    if (i % 7 === 0) { model.damage(c.id, 100); live.delete(c.id); }
    else if (i % 11 === 0) { model.promote(c.id, 'piece', { x: 40 + i, y: 4, z: 0 }, identity, 'dynamic'); live.delete(c.id); }
  }
  for (const c of source) {
    const p = c.position;
    const expected = source.filter(other => live.has(other.id) && Math.abs(other.position.x - p.x) + Math.abs(other.position.y - p.y) + Math.abs(other.position.z - p.z) === 1).map(c => c.id).sort((a, b) => a - b);
    assert.deepEqual(model.staticNeighbors(p).sort((a, b) => a - b), expected);
  }
  const origin = { x: -.3, y: 1.4, z: .7 }, radius = 2.6;
  const expected = source.filter(c => live.has(c.id) && Math.hypot(c.position.x - origin.x, c.position.y - origin.y, c.position.z - origin.z) <= radius).map(c => c.id).sort((a, b) => a - b);
  assert.deepEqual(model.queryStaticSphere(origin, radius).sort((a, b) => a - b), expected);
  for (const radius of [-1, NaN, Infinity]) assert.deepEqual(model.queryStaticSphere(origin, radius), []);
});

test('sparse JSON save roundtrip owns nested values and malformed restore cannot partly change authority', () => {
  const source = [sample(1, 0), sample(2, 1), sample(3, 2), sample(4, 3)], model = new CompactStructures(source);
  assert.deepEqual(model.changes(), []);
  model.damage(1, .1); model.damage(1, .2); model.damage(2, 100);
  model.promote(3, 'piece-3', { x: 10.5, y: 7, z: -3 }, identity, 'dynamic');
  const saved = JSON.parse(JSON.stringify(model.changes()));
  assert.equal(saved.length, 3); assert.equal(saved[0].position, undefined, 'static HP edits do not allocate pose records');
  const restored = new CompactStructures(source); restored.restoreChanges(saved);
  assert.deepEqual(restored.changes(), model.changes());
  for (const c of source) assert.deepEqual(restored.cell(c.id), model.cell(c.id));
  saved[2].position.x = 999; saved[2].rotation.w = 0; saved[0].hp = 0;
  const returned = restored.changes(); returned[2].position!.z = 999; returned[2].rotation!.w = 0;
  assert.deepEqual(restored.changes(), model.changes());
  const before = restored.changes(), revision = restored.dirtySince(0).revision;
  for (const mutate of [
    (rows: any[]) => { rows[0].hp = NaN; },
    (rows: any[]) => { rows[0].id = 99999; },
    (rows: any[]) => { rows.push(rows[0]); },
    (rows: any[]) => { rows[2].position.x = Infinity; },
    (rows: any[]) => { delete rows[2].chunkId; },
    (rows: any[]) => { rows[0].state = 'rubble'; },
    (rows: any[]) => { rows[1].hp = 1; },
    (rows: any[]) => { rows[0].loss = -1; },
  ]) {
    const rows = structuredClone(before); mutate(rows);
    assert.throws(() => restored.restoreChanges(rows), /invalid|duplicate/i);
    assert.deepEqual(restored.changes(), before);
    assert.equal(restored.dirtySince(0).revision, revision);
  }
});

test('immutable numeric inventory is complete without retaining or returning a mutable ID array', () => {
  const model = new CompactStructures([sample(7, 0), sample(-2, 1), sample(99, 2)]);
  assert.deepEqual(Array.from({ length: model.cellCount }, (_, i) => model.idAtIndex(i)), [-2, 7, 99]);
  for (const index of [-1, .5, 3, NaN]) assert.equal(model.idAtIndex(index), null);
  model.damage(7, 100); assert.equal(model.idAtIndex(1), 7);
});

test('city sparse edits and JSON restore preserve exact cells across all original building IDs', () => {
  const source = sparseStructureFixture('city').cells, model = new CompactStructures(source);
  const dense = new Map<number, CellView>(); let seed = 9943;
  for (let step = 0; step < 400; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const original = source[seed % source.length], expected = dense.get(original.id) ?? view(original);
    dense.set(original.id, expected);
    const amount = (step % 21 + 1) / 13, used = Math.min(expected.hp, amount);
    expected.hp -= used; if (expected.hp <= 1e-8) { expected.hp = 0; expected.state = 'gone'; }
    assert.equal(model.damage(original.id, amount), used);
    if (expected.hp > 0 && step % 17 === 0) {
      expected.state = 'dynamic'; expected.position = { x: original.position.x + .25, y: original.position.y + 3.125, z: original.position.z - .5 };
      model.promote(original.id, `piece-${step}`, expected.position, identity, 'dynamic');
    }
  }
  const restored = new CompactStructures(source); restored.restoreChanges(JSON.parse(JSON.stringify(model.changes())));
  for (const original of source) {
    const expected = dense.get(original.id) ?? view(original);
    assert.deepEqual(model.cell(original.id), expected);
    assert.deepEqual(restored.cell(original.id), expected);
  }
  assert.deepEqual(restored.changes(), model.changes());
  assert.equal(model.diagnostics().changedCells, dense.size);
});

test('scalar immutable readers and original index lookup need no CellView and reject invalid bounds', () => {
  const source = [sample(99, -5, { anchor: false }), sample(-9, 4, { anchor: true, material: 'stone' }), sample(1234, 12)];
  const model = new CompactStructures(source);
  model.cell = () => { throw new Error('Scalar topology read must not materialize a CellView'); };
  for (const c of source) {
    const index = model.indexOf(c.id); assert.ok(index >= 0);
    assert.equal(model.indexAt(c.position.x, c.position.y, c.position.z), index);
    assert.equal(model.idAtIndex(index), c.id);
    assert.equal(model.xAt(index), c.position.x); assert.equal(model.yAt(index), c.position.y); assert.equal(model.zAt(index), c.position.z);
    assert.equal(model.materialAt(index), c.material); assert.equal(model.objectIdAt(index), c.objectId); assert.equal(model.anchorAt(index), c.anchor);
  }
  for (const index of [-1, .5, 3, NaN, Infinity]) {
    assert.equal(model.xAt(index), null); assert.equal(model.yAt(index), null); assert.equal(model.zAt(index), null);
    assert.equal(model.materialAt(index), null); assert.equal(model.objectIdAt(index), null); assert.equal(model.anchorAt(index), undefined);
  }
  assert.equal(model.indexOf(1), -1); assert.equal(model.indexOf(NaN), -1);
  assert.equal(model.indexAt(-5, 0, 1), -1); assert.equal(model.indexAt(.1, 1, 0), -1);
  model.damage(99, .25); model.promote(99, 'piece', { x: 50, y: 50, z: 50 }, identity, 'dynamic');
  assert.equal(model.indexAt(-5, 1, 0), model.indexOf(99)); assert.equal(model.xAt(model.indexOf(99)), -5);
});
