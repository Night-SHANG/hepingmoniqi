import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactTerrain, type TerrainConfig } from './compact-terrain.ts';
import { legacyLayoutColumns } from './legacy-layout-columns.ts';
import { GAME_SOIL_HP, createGameFixture } from '../../src/structural/game-fixtures.ts';
import { packStaticCells } from '../../src/structural/static-packing.ts';
import { createSupportGraph } from '../../src/structural/support.ts';
import type { Cell, CellView } from '../../src/structural/types.ts';

const cfg: TerrainConfig = {
  map: 'tiny', minX: -9, maxX: 9, minZ: -5, maxZ: 5,
  // An irregular historic footprint exercises the two separately layered ID blocks.
  originalColumn: (x, z) => x <= -2 || (x <= 4 && Math.abs(z) <= 1),
};
const xyz = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
const identity = { x: 0, y: 0, z: 0, w: 1 };

// Independent bounded dense oracle, retaining the exact ordering/formula in
// production game-fixtures.ts. It deliberately does not call CompactTerrain.
function dense(config: TerrainConfig): CellView[] {
  const original: { x: number; z: number }[] = [], added: typeof original = [];
  for (let x = config.minX; x <= config.maxX; x++) for (let z = config.minZ; z <= config.maxZ; z++)
    (config.originalColumn?.(x, z) === false ? added : original).push({ x, z });
  const result: CellView[] = []; let id = -1;
  for (const points of [original, added]) for (let depth = 1; depth <= 8; depth++) for (const { x, z } of points) {
    const y = -depth, hp = GAME_SOIL_HP[depth - 1];
    const color = depth === 1 ? [0x8b9650, 0x9aa45a, 0x778448][Math.abs(x * 7 + z * 11) % 3]
      : [0x775238, 0x8b6240, 0x9a7048][Math.abs(x * 73 + y * 31 + z * 17) % 3];
    result.push({ id: id--, objectId: `game:${config.map}:geology`, role: 'terrain', position: { x, y, z }, material: 'soil', color, hp, maxHp: hp,
      ...(depth === 8 && (x === config.minX || x === config.maxX || z === config.minZ || z === config.maxZ) ? { anchor: true } : {}),
      state: 'static', rotation: { ...identity } });
  }
  return result;
}
const sorted = (ids: number[]) => ids.sort((a, b) => a - b);

test('pristine descriptor retains every cell, exact metadata, old/additional IDs, and no per-cell mutable allocation', () => {
  const model = new CompactTerrain(cfg), expected = dense(cfg);
  assert.equal(model.cellCount, 19 * 11 * 8);
  assert.equal(model.diagnostics().mutableChunks, 0);
  assert.equal(model.diagnostics().mutableBytes, 0);
  assert.equal(model.diagnostics().columnIndexBytes, 19 * 11 * 8);
  for (const c of expected) {
    assert.deepEqual(model.cell(c.id), c);
    assert.equal(model.idAt(c.position.x, c.position.y, c.position.z), c.id);
  }
  assert.equal(model.cell(-model.cellCount - 1), null);
  for (const p of [[0, 0, 0], [0, -9, 0], [-10, -1, 0], [0, -1, 6], [.1, -1, 0]])
    assert.equal(model.idAt(...p as [number, number, number]), null);
});

test('rectangular IDs and metadata equal actual production courtyard soil without allocating a city', () => {
  const model = new CompactTerrain({ map: 'courtyard', minX: -27, maxX: 27, minZ: -22, maxZ: 22 });
  const fixture = createGameFixture('courtyard');
  let checked = 0;
  for (const c of fixture.cells) if (c.role === 'terrain') {
    const { objective: _, ...spec } = c;
    assert.deepEqual(model.cell(c.id), { ...spec, state: 'static', rotation: identity }); checked++;
  }
  assert.equal(checked, 19_800);
  assert.equal(model.diagnostics().columnIndexBytes, 0, 'all-original rectangles need no per-column ID maps');
  assert.equal(model.diagnostics().mutableChunks, 0);
});

test('exact double HP arithmetic and chunk-local changes match dense damage, including negative chunks', () => {
  const model = new CompactTerrain(cfg), expected = dense(cfg), byId = new Map(expected.map(c => [c.id, c]));
  let seed = 785;
  for (let i = 0; i < 400; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const c = expected[seed % expected.length], amount = (seed % 110) / 13;
    const used = Math.min(c.hp, amount); c.hp -= used; if (c.hp <= 1e-8) { c.hp = 0; c.state = 'gone'; }
    assert.equal(model.damage(c.id, amount), used);
    assert.deepEqual(model.cell(c.id), c);
  }
  for (const c of byId.values()) assert.deepEqual(model.cell(c.id), c);
  assert.ok(model.diagnostics().mutableChunks <= 8);
  assert.equal(model.diagnostics().mutableBytes, model.diagnostics().mutableChunks * 512 * 9);
  const before = model.diagnostics(); model.damage(-1, 0); model.damage(5, 2); model.damage(-1, NaN);
  assert.deepEqual(model.diagnostics(), before);
});

test('six-neighbor queries and bounded sphere candidates equal independent dense occupancy', () => {
  const model = new CompactTerrain(cfg), expected = dense(cfg);
  for (const c of expected) if ((c.id % 7) === 0) { model.damage(c.id, 100); c.hp = 0; c.state = 'gone'; }
  const occupied = new Map(expected.filter(c => c.state === 'static').map(c => [xyz(c.position), c]));
  for (const c of expected) {
    const p = c.position;
    const neighbors = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]]
      .map(([x,y,z]) => occupied.get(`${p.x+x},${p.y+y},${p.z+z}`)?.id).filter(id => id !== undefined) as number[];
    assert.deepEqual(sorted(model.staticNeighbors(p)), sorted(neighbors));
  }
  const origin = { x: -7.2, y: -3.4, z: 1.1 }, radius = 2.7;
  const candidates = expected.filter(c => c.state === 'static' && Math.hypot(c.position.x-origin.x,c.position.y-origin.y,c.position.z-origin.z)<=radius).map(c=>c.id);
  assert.deepEqual(sorted(model.queryStaticSphere(origin, radius)), sorted(candidates));
});

test('a full-depth hole stays empty and packed production colliders contain exactly the remaining occupied volume', () => {
  const model = new CompactTerrain(cfg), expected = dense(cfg);
  assert.equal(model.columnHit(0, 0), -.5);
  for (let depth = 1; depth <= 8; depth++) {
    const id = model.idAt(0, -depth, 0)!; model.damage(id, 100);
    const c = expected.find(c => c.id === id)!; c.hp = 0; c.state = 'gone';
    assert.equal(model.columnHit(0, 0), depth === 8 ? null : -depth - .5);
  }
  assert.equal(model.columnHit(10, 0), null);
  const compactBoxes = packStaticCells(model.staticCellsInBounds(cfg));
  const denseBoxes = packStaticCells(expected.filter(c => c.state === 'static'));
  assert.deepEqual(compactBoxes, denseBoxes);
  for (const b of compactBoxes) {
    const within = Math.abs(b.center.x) < b.half.x && Math.abs(b.center.z) < b.half.z;
    assert.equal(within, false, 'No packed collision box spans the missing column');
  }
});

test('removing bottom outer roots and an interior ring matches production global support, never synthetic ground', () => {
  const small = { map: 'support', minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  const model = new CompactTerrain(small), expected = dense(small);
  const building: Cell = {id: 1, objectId: 'tiny-house', role: 'foundation', position: {x:0,y:0,z:0}, material:'stone',color:0,hp:5,maxHp:5};
  const graph = createSupportGraph([...expected, building]);
  assert.deepEqual(graph.unsupported(), []);
  // Cut all eight layers around a pillar; center soil + building must detach.
  const removed = expected.filter(c => Math.abs(c.position.x)+Math.abs(c.position.z) === 1).map(c=>c.id);
  for (const id of removed) model.damage(id, 100);
  graph.remove(removed);
  const compactGraph = createSupportGraph([...model.staticCellsInBounds(small), building]);
  assert.deepEqual(compactGraph.unsupported(), graph.unsupported());
  assert.deepEqual(sorted(graph.unsupported().flatMap(p=>p.cells)), sorted([...expected.filter(c=>c.position.x===0&&c.position.z===0).map(c=>c.id),1]));
  const roots = model.staticCellsInBounds(small).filter(c=>c.anchor).map(c=>c.id);
  for (const id of roots) model.damage(id,100); graph.remove(roots);
  const allDetached = createSupportGraph([...model.staticCellsInBounds(small),building]);
  assert.deepEqual(allDetached.unsupported(),graph.unsupported());
  assert.equal(graph.unsupported().flatMap(p=>p.cells).length, expected.length - removed.length - roots.length + 1);
});

test('static departure keeps IDs/HP for dynamic and persistent rubble while vacating original lattice', () => {
  const model = new CompactTerrain(cfg), id = model.idAt(0,-1,0)!;
  model.damage(id, .125);
  const before = model.cell(id)!;
  model.promote(id, 'piece-1', {x:4.25,y:3,z:2.5}, identity, 'dynamic');
  assert.equal(model.staticAt(0,-1,0), null);
  assert.deepEqual(model.cell(id), {...before,position:{x:4.25,y:3,z:2.5},state:'dynamic'});
  model.promote(id, 'piece-1', {x:4.25,y:-.5,z:2.5}, identity, 'rubble');
  assert.equal(model.cell(id)!.state, 'rubble');
  assert.equal(model.cell(id)!.hp, before.hp);
  assert.equal(model.columnHit(0,0), -1.5);
  const save = model.changes();
  assert.equal(save.length,1); assert.equal(save[0].id,id); assert.equal(save[0].loss,GAME_SOIL_HP[0]); assert.equal(save[0].chunkId,'piece-1');
  const restored = new CompactTerrain(cfg); restored.restoreChanges(save);
  assert.deepEqual(restored.cell(id),model.cell(id));
  assert.deepEqual(restored.changes(),save);
  model.damage(id,100); assert.equal(model.cell(id)!.state,'gone');
  assert.equal(model.columnHit(0,0),-1.5,'destroying moved rubble must not fill its original hole');
});

test('sparse change roundtrip preserves pristine defaults, partial HP, complete holes, and detached metadata', () => {
  const model = new CompactTerrain(cfg);
  assert.deepEqual(model.changes(),[]);
  model.damage(-1,.125); model.damage(-10,100); model.promote(-25,'piece-4',{x:3,y:2,z:7},identity,'dynamic');
  const save = model.changes(); assert.equal(save.length,3);
  const restored = new CompactTerrain(cfg); restored.restoreChanges(save);
  for (let id = -1; id >= -model.cellCount; id--) assert.deepEqual(restored.cell(id), model.cell(id));
  save[0].hp = 999;
  assert.notEqual(restored.cell(-25)!.hp,999,'save records are owned values, not authority');
});

test('city descriptor retains known historic IDs and all 401800 cells without ever constructing city Cell objects', t => {
  const start=performance.now(),layout=legacyLayoutColumns('city'),model=new CompactTerrain(layout.config);
  assert.equal(layout.buildingCount,36);assert.equal(layout.originalColumns,16446);
  assert.equal(model.cellCount,401800);
  assert.deepEqual(model.cell(-4649)!.position,{x:-45,y:-1,z:43});
  assert.deepEqual(model.cell(-4649-7*16446)!.position,{x:-45,y:-8,z:43});
  assert.equal(model.idAt(-122,-1,-102),-131569);
  assert.equal(model.idAt(122,-8,102),-401800);
  assert.equal(model.cell(-401800)!.anchor,true);
  assert.equal(model.diagnostics().mutableBytes,0);
  assert.equal(model.diagnostics().columnIndexBytes,401800);
  t.diagnostic(JSON.stringify({descriptorSetupMs:performance.now()-start,...model.diagnostics(),note:'JS object overhead, render data, buildings, support, Rapier, and dynamic/rubble work are excluded'}));
});
