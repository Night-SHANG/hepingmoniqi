import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { CompactStaticColliders, type CompactStaticSource } from './static-colliders.js';
import { packStaticCells } from '../structural/static-packing.js';
import { createDenseFixture } from './fixture.js';
import { CompactAuthorityStore } from './store.js';
import type { Cell, Point } from '../structural/types.js';

before(async () => { await RAPIER.init(); });
const identity = { x: 0, y: 0, z: 0, w: 1 };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
function sourceFixture(min: Point = { x: -9, y: -8, z: -5 }, max: Point = { x: 9, y: -1, z: 5 }) {
  const cells = new Map<number, { position: Point; material: Cell['material']; hp: number; state: 'static' | 'dynamic' | 'gone' }>();
  const ids = new Map<string, number>();
  let serial = 0;
  for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
    const id = ++serial;
    cells.set(id, { position: { x, y, z }, material: 'soil', hp: 10, state: 'static' });
    ids.set(key(x, y, z), id);
  }
  const source: CompactStaticSource = {
    fixture: {
      bounds: Object.freeze({ minX: min.x, maxX: max.x, minY: min.y, maxY: max.y, minZ: min.z, maxZ: max.z }),
      originalPosition: id => cells.get(id)?.position,
      forEachChunk(size, visit) {
        for (let x = Math.floor(min.x / size); x <= Math.floor(max.x / size); x++)
          for (let y = Math.floor(min.y / size); y <= Math.floor(max.y / size); y++)
            for (let z = Math.floor(min.z / size); z <= Math.floor(max.z / size); z++) visit(x, y, z);
      },
    },
    staticIdAt(x, y, z) { const id = ids.get(key(x, y, z)); return id !== undefined && cells.get(id)?.state === 'static' ? id : null; },
    materialOf: id => cells.get(id)?.material,
  };
  const idAt = (x: number, y: number, z: number) => ids.get(key(x, y, z))!;
  return { source, cells, idAt };
}
function ray(world: RAPIER.World, x: number, z: number, originY = 2) {
  return world.castRay(new RAPIER.Ray({ x, y: originY, z }, { x: 0, y: -1, z: 0 }), 40, true);
}
function hitY(world: RAPIER.World, x: number, z: number) { const hit = ray(world, x, z); return hit === null ? null : 2 - hit.timeOfImpact; }

test('finite negative-bound soil packs into clipped boxes in the caller-owned world', () => {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), fixture = sourceFixture();
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    world.step();
    assert.equal(world.colliders.len(), 8);
    assert.equal(hitY(world, 0, 0), -.5);
    assert.equal(hitY(world, -9, -5), -.5);
    assert.equal(hitY(world, 10, 0), null);
    assert.equal(hitY(world, 0, 6), null);
  } finally { world.free(); }
});

function cut(index: CompactStaticColliders, fixture: ReturnType<typeof sourceFixture>, x: number, z: number, from = -1, to = -8) {
  for (let y = from; y >= to; y--) {
    const cell = fixture.cells.get(fixture.idAt(x, y, z))!;
    cell.hp = 0; cell.state = 'gone'; index.markDirtyAt({ x, y, z });
  }
  index.flush();
}

test('all eight destructible layers expose exact depth, then no ray or shape support', () => {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), fixture = sourceFixture();
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    assert.equal(index.diagnostics().temporaryCells, 0, 'full uniform chunks require no temporary Cell objects');
    for (let y = -1; y >= -8; y--) {
      cut(index, fixture, 0, 0, y, y); world.step();
      assert.equal(hitY(world, 0, 0), y === -8 ? null : y - .5);
    }
    assert.equal(world.castShape({ x: 0, y: 1, z: 0 }, identity, { x: 0, y: -1, z: 0 }, new RAPIER.Ball(.2), 0, 30, true), null);
    assert.equal(hitY(world, 1, 0), -.5);
    assert.equal(index.diagnostics().retainedCellIds, 0);
    assert.ok(index.diagnostics().peakTemporaryCells <= 512);
    for (const region of index.regions()) assert.equal('cellIds' in region, false);
  } finally { index.dispose(); world.free(); }
});

test('each of two CCD balls traverses the same removed volume while its neighbor lands on real soil', () => {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), fixture = sourceFixture();
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    world.timestep = 1 / 120; world.integrationParameters.maxCcdSubsteps = 4;
    cut(index, fixture, 0, 0); world.step();
    const ball = (x: number) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 3, 0).setLinvel(0, -25, 0).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.ball(.15).setRestitution(0), body); return body;
    };
    for (let shot = 1; shot <= 2; shot++) {
      const projectile = ball(0);
      for (let i = 0; i < 80; i++) world.step();
      assert.ok(projectile.translation().y < -12, `ball ${shot} must not encounter a hidden floor`);
      world.removeRigidBody(projectile);
    }
    const neighbor = ball(1);
    for (let i = 0; i < 120; i++) world.step();
    assert.ok(Math.abs(neighbor.translation().y + .35) < .04);
  } finally { index.dispose(); world.free(); }
});

test('construction honors both original holes and preedited dynamic/gone cells, including structures', () => {
  const fixture = sourceFixture({ x: 0, y: -8, z: 0 }, { x: 3, y: 2, z: 0 });
  fixture.cells.delete(fixture.idAt(0, -1, 0)); // Original absent source position.
  for (let y = -8; y <= 2; y++) fixture.cells.get(fixture.idAt(1, y, 0))!.state = 'gone';
  fixture.cells.get(fixture.idAt(2, 2, 0))!.state = 'dynamic';
  for (const cell of fixture.cells.values()) if (cell.position.y >= 0) cell.material = 'stone';
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), index = new CompactStaticColliders(world, fixture.source);
  try {
    world.step();
    assert.equal(ray(world, 1, 0, 5), null, 'preedited hole must not become pristine solid soil');
    const hit = ray(world, 2, 0, 5)!;
    assert.equal(5 - hit.timeOfImpact, 1.5);
    assert.equal(index.resolveCollider(hit.collider.handle, { x: 2, y: 1.5, z: 0 }), fixture.idAt(2, 1, 0));
    const cavity = world.castRay(new RAPIER.Ray({ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 0 }), 20, true)!;
    assert.equal(cavity.timeOfImpact, .5, 'original cavity remains empty');
    assert.equal(index.colliderForCell(fixture.idAt(2, 2, 0)), undefined, 'dynamic belongs to simulation, not this index');
  } finally { index.dispose(); world.free(); }
});

test('material boundaries preserve mass, friction and exact packed membership without color/hp splits', () => {
  const fixture = sourceFixture({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
  fixture.cells.get(fixture.idAt(0, 0, 0))!.material = 'wood';
  fixture.cells.get(fixture.idAt(1, 0, 0))!.material = 'wood';
  fixture.cells.get(fixture.idAt(1, 0, 0))!.hp = .2;
  fixture.cells.get(fixture.idAt(2, 0, 0))!.material = 'stone';
  fixture.cells.get(fixture.idAt(3, 0, 0))!.material = 'stone';
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), index = new CompactStaticColliders(world, fixture.source);
  try {
    assert.equal(world.colliders.len(), 2);
    const wood = index.colliderForCell(fixture.idAt(0, 0, 0))!, stone = index.colliderForCell(fixture.idAt(3, 0, 0))!;
    assert.equal(wood.handle, index.colliderForCell(fixture.idAt(1, 0, 0))!.handle);
    assert.notEqual(wood.handle, stone.handle);
    assert.equal(wood.mass(), 4); assert.equal(stone.mass(), 16);
    assert.ok(Math.abs(wood.friction() - .85) < 1e-6);
    assert.deepEqual(index.regions().map(r => r.material), ['wood', 'stone']);
    assert.deepEqual(index.regions().map(r => r.mass), [4, 16]);
  } finally { index.dispose(); world.free(); }
});

test('dirty edits rebuild only affected negative/positive chunks and partial HP keeps handles', () => {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), fixture = sourceFixture();
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    world.step(); const untouched = ray(world, 9, -4)!.collider.handle, before = ray(world, 0, 0)!.collider.handle;
    fixture.cells.get(fixture.idAt(0, -1, 0))!.hp -= .125;
    assert.equal(index.flush(), false);
    assert.equal(index.colliderForCell(fixture.idAt(0, -1, 0))!.handle, before);
    for (const x of [-9, -8, -1, 0, 7, 8]) cut(index, fixture, x, 0);
    world.step();
    for (const x of [-9, -8, -1, 0, 7, 8]) assert.equal(hitY(world, x, 0), null);
    for (const x of [-7, -2, 1, 6, 9]) assert.equal(hitY(world, x, 0), -.5);
    assert.equal(ray(world, 9, -4)!.collider.handle, untouched);
    assert.equal(index.diagnostics().dirtyChunks, 0);
    assert.equal(index.diagnostics().repackedChunks, 6);
    assert.equal(index.markDirtyAt({ x: 100, y: -1, z: 0 }), false);
    assert.equal(index.markDirtyAt({ x: NaN, y: -1, z: 0 }), false);
  } finally { index.dispose(); world.free(); }
});

test('collision identity uses current static lookup and box-local contact points, rejecting invalid handles', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), fixture = sourceFixture();
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    world.step(); const handle = ray(world, 0, 0)!.collider.handle, at = { x: 0, y: -.5, z: 0 };
    assert.equal(index.resolveCollider(handle, at), fixture.idAt(0, -1, 0));
    fixture.cells.get(fixture.idAt(0, -1, 0))!.state = 'gone';
    index.markDirtyAt({ x: 0, y: -1, z: 0 });
    assert.equal(index.resolveCollider(handle, at), null, 'stale geometry cannot resolve a removed cell');
    assert.equal(index.resolveCollider(handle, { x: 100, y: -.5, z: 0 }), null);
    assert.equal(index.resolveCollider(handle, { x: 0, y: Infinity, z: 0 }), null);
    assert.equal(index.resolveCollider(handle), null);
    assert.equal(index.resolveCollider(-123, at), null);
    assert.equal(index.colliderForCell(999999), undefined);
    index.flush(); world.step();
    const next = ray(world, 0, 0)!;
    assert.equal(index.resolveCollider(next.collider.handle, { x: 0, y: -1.5, z: 0 }), fixture.idAt(0, -2, 0));
    world.removeCollider(next.collider, true);
    assert.equal(index.resolveCollider(next.collider.handle, { x: 0, y: -1.5, z: 0 }), null);
  } finally { index.dispose(); world.free(); }
});

test('dispose removes only owned static colliders and leaves caller world and dynamic bodies usable', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), fixture = sourceFixture();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(50, 1, 0));
  const foreign = world.createCollider(RAPIER.ColliderDesc.ball(.2), body);
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    const staticHandle = index.colliderForCell(fixture.idAt(0, -1, 0))!.handle;
    index.dispose(); index.dispose();
    assert.equal(world.colliders.len(), 1); assert.equal(world.bodies.len(), 1);
    assert.ok(world.getCollider(foreign.handle)); world.step();
    assert.equal(index.resolveCollider(staticHandle, { x: 0, y: -.5, z: 0 }), null);
    assert.equal(index.colliderForCell(fixture.idAt(0, -1, 0)), undefined);
    assert.equal(index.flush(), false); assert.deepEqual(index.regions(), []);
  } finally { world.free(); }
});


test('shifted real solver contact points retain the correct cell identity for structural impact damage', () => {
  const fixture = sourceFixture({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), index = new CompactStaticColliders(world, fixture.source);
  try {
    world.timestep = 1 / 120;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 0).setLinvel(0, -15, 0).setCcdEnabled(true));
    const dynamic = world.createCollider(RAPIER.ColliderDesc.cuboid(.5, .5, .5), body);
    const floor = index.colliderForCell(fixture.idAt(0, 0, 0))!;
    let contacts = 0;
    for (let step = 0; step < 25; step++) {
      world.step();
      world.contactPair(dynamic, floor, manifold => {
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const p = manifold.solverContactPoint(i)!, center = dynamic.translation();
          const shifted = { x: p.x + (center.x - p.x) * .02, y: p.y + (center.y - p.y) * .02, z: p.z + (center.z - p.z) * .02 };
          assert.equal(index.resolveCollider(floor.handle, shifted), fixture.idAt(0, 0, 0));
          contacts++;
        }
      });
    }
    assert.ok(contacts > 0, 'real contact manifold must be exercised');
  } finally { index.dispose(); world.free(); }
});

test('an empty dense fixture creates no geometry and malformed construction leaks no owned colliders', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const source: CompactStaticSource = {
    fixture: { bounds: { minX: 0, maxX: -1, minY: 0, maxY: -1, minZ: 0, maxZ: -1 }, originalPosition: () => undefined, forEachChunk() {} },
    staticIdAt: () => null, materialOf: () => undefined,
  };
  try {
    const empty = new CompactStaticColliders(world, source);
    assert.equal(world.colliders.len(), 0); assert.equal(empty.flush(), false); empty.dispose();
    const fixture = sourceFixture({ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
    const material = fixture.source.materialOf;
    fixture.source.materialOf = id => id === fixture.idAt(8, 0, 0) ? undefined : material(id);
    const foreign = world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(30, 0, 0));
    assert.throws(() => new CompactStaticColliders(world, fixture.source), /metadata/);
    assert.equal(world.colliders.len(), 1); assert.ok(world.getCollider(foreign.handle));
    assert.throws(() => new CompactStaticColliders(world, { ...source, fixture: { ...source.fixture, bounds: { ...source.fixture.bounds, minX: NaN } } }), /bounds/);
  } finally { world.free(); }
});

test('mixed structures, bridge openings and underground cavities match the established dense packer', () => {
  const fixture = sourceFixture({ x: -3, y: -8, z: -2 }, { x: 9, y: 4, z: 2 });
  const cells: Cell[] = [];
  for (const [id, cell] of fixture.cells) {
    const { x, y, z } = cell.position;
    const gone = (x === 0 && z === 0) || (x === 7 && y >= -3 && z === 1) || (x === 8 && y <= -5 && z === 1) || (y >= 0 && y < 4 && x !== -3 && x !== 9);
    if (gone) { cell.state = 'gone'; continue; }
    cell.material = y < 0 ? 'soil' : x < 3 ? 'wood' : 'stone';
    cells.push({ id, position: { ...cell.position }, material: cell.material, role: y < 0 ? 'terrain' : 'bridge', objectId: 'oracle', hp: cell.hp, maxHp: 10, color: id });
  }
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), dense = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const index = new CompactStaticColliders(world, fixture.source);
  try {
    for (const box of packStaticCells(cells)) dense.createCollider(RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z).setTranslation(box.center.x, box.center.y, box.center.z));
    world.step(); dense.step(); assert.equal(world.colliders.len(), dense.colliders.len());
    for (let x = -4; x <= 10; x++) for (let z = -3; z <= 3; z++) for (const dx of [-.4, 0, .4]) {
      assert.equal(ray(world, x + dx, z, 6)?.timeOfImpact, ray(dense, x + dx, z, 6)?.timeOfImpact);
    }
    for (let x = -3; x <= 9; x++) for (let y = -8; y <= 4; y++) for (let z = -2; z <= 2; z++) {
      const ray = new RAPIER.Ray({ x, y, z }, { x: 1, y: 0, z: 0 });
      assert.equal(world.castRay(ray, 30, true)?.timeOfImpact, dense.castRay(ray, 30, true)?.timeOfImpact);
    }
    let volume = 0;
    for (const region of index.regions()) {
      assert.ok(Object.isFrozen(region) && Object.isFrozen(region.min) && Object.isFrozen(region.max));
      for (let x = region.min.x; x <= region.max.x; x++) for (let y = region.min.y; y <= region.max.y; y++) for (let z = region.min.z; z <= region.max.z; z++) {
        const id = fixture.source.staticIdAt(x, y, z);
        assert.notEqual(id, null, 'boxes cannot fill an opening');
        assert.equal(fixture.source.materialOf(id!), region.material);
        assert.equal(index.colliderForCell(id!)!.handle, region.handle);
        volume++;
      }
    }
    assert.equal(volume, cells.length);
    assert.ok(Object.isFrozen(index.bounds));
  } finally { index.dispose(); world.free(); dense.free(); }
});


test('actual sparse authority changes rebuild topology only and support an already edited source', () => {
  const source = sourceFixture({ x: 0, y: -8, z: 0 }, { x: 1, y: -1, z: 0 });
  const cells: Cell[] = [...source.cells].map(([id, c]) => ({ id, position: c.position, material: c.material, hp: c.hp, maxHp: 10, color: 0, role: 'terrain', objectId: 'soil' }));
  const store = new CompactAuthorityStore(createDenseFixture({ id: 'real-sparse-authority', cells }));
  const top = source.idAt(0, -1, 0), edited = store.writable(top)!;
  edited.hp = 0; edited.loss = 10; edited.state = 'gone'; store.markChanged(top);
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 }), index = new CompactStaticColliders(world, store);
  try {
    world.step(); assert.equal(hitY(world, 0, 0), -1.5);
    const neighborId = source.idAt(1, -1, 0), handle = index.colliderForCell(neighborId)!.handle;
    let cursor = store.revision;
    const neighbor = store.writable(neighborId)!; neighbor.hp -= .5; neighbor.loss += .5; store.markChanged(neighborId);
    const hp = store.changesSince(cursor); cursor = hp.revision;
    assert.equal(hp.edits[0].topologyChanged, false);
    for (const edit of hp.edits) if (edit.topologyChanged) index.markDirtyAt(edit.position);
    assert.equal(index.flush(), false); assert.equal(index.colliderForCell(neighborId)!.handle, handle);
    for (let y = -2; y >= -8; y--) {
      const id = source.idAt(0, y, 0), cell = store.writable(id)!;
      cell.hp = 0; cell.loss = 10; cell.state = 'gone'; store.markChanged(id);
    }
    const changes = store.changesSince(cursor);
    for (const edit of changes.edits) if (edit.topologyChanged) index.markDirtyAt(edit.position);
    assert.equal(index.diagnostics().dirtyChunks, 1);
    assert.equal(index.flush(), true); world.step();
    assert.equal(hitY(world, 0, 0), null); assert.equal(hitY(world, 1, 0), -.5);
    assert.equal(store.diagnostics().retainedPristineStates, 0);
    assert.equal(store.diagnostics().mutableStates, 9, 'collision indexing must not allocate pristine authority rows');
  } finally { index.dispose(); world.free(); }
});
