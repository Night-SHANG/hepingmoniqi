import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuralFixture } from './fixtures';
import type { Cell, Point } from './types';

const key = ({ x, y, z }: Point) => `${x},${y},${z}`;
const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Independent six-neighbor reference, deliberately not the runtime support graph. */
function supported(cells: Cell[]): Set<number> {
  const occupancy = new Map(cells.map(cell => [key(cell.position), cell]));
  const queue = cells.filter(cell => cell.anchor);
  const visited = new Set(queue.map(cell => cell.id));
  for (let i = 0; i < queue.length; i++) {
    const { x, y, z } = queue[i].position;
    for (const [dx, dy, dz] of offsets) {
      const next = occupancy.get(key({ x: x + dx, y: y + dy, z: z + dz }));
      if (next && !visited.has(next.id)) { visited.add(next.id); queue.push(next); }
    }
  }
  return visited;
}

for (const [map, buildingCount, budget] of [
  ['lab', 2, 8_000], ['neighborhood', 9, 50_000], ['city', 36, 180_000],
] as const) {
  test(`${map}: integer authoritative cells, exact building count and finite budget`, () => {
    const fixture = createStructuralFixture(map);
    assert.equal(fixture.id, `structural:${map}`);
    assert.ok(fixture.cells.length > 0 && fixture.cells.length < budget, `${fixture.cells.length} cells`);
    assert.equal(new Set(fixture.cells.map(cell => cell.id)).size, fixture.cells.length);
    assert.equal(new Set(fixture.cells.map(cell => key(cell.position))).size, fixture.cells.length);
    assert.ok(fixture.cells.every(cell => Object.values(cell.position).every(Number.isInteger)));
    assert.ok(fixture.cells.every(cell => cell.hp > 0 && cell.hp === cell.maxHp));
    assert.deepEqual([...new Set(fixture.cells.filter(cell => cell.role === 'building').map(cell => cell.objectId))].sort(),
      Array.from({ length: buildingCount }, (_, i) => `warm:${map}:building-${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual([...new Set(fixture.cells.map(cell => cell.role))].sort(), ['bridge', 'building', 'foundation', 'road', 'terrain', 'tree']);
    assert.ok(fixture.cells.some(cell => cell.material === 'glass' && [0x8bc7cf, 0xa9dfe0].includes(cell.color)));
    assert.ok(fixture.cells.some(cell => cell.material === 'roof' && [0xa94633, 0xbc553d, 0x923b30].includes(cell.color)));
    assert.ok(fixture.cells.some(cell => cell.material === 'wood' && [0x996238, 0xae7545, 0xc18a53, 0xb47a47].includes(cell.color)));
  });

  test(`${map}: every baseline cell has a real path to bottom perimeter soil`, () => {
    const { cells } = createStructuralFixture(map);
    assert.equal(supported(cells).size, cells.length);
    const terrain = cells.filter(cell => cell.role === 'terrain');
    assert.deepEqual([...new Set(terrain.map(cell => cell.position.y))].sort((a, b) => a - b), [-3, -2, -1]);
    const minX = Math.min(...terrain.map(cell => cell.position.x));
    const maxX = Math.max(...terrain.map(cell => cell.position.x));
    const minZ = Math.min(...terrain.map(cell => cell.position.z));
    const maxZ = Math.max(...terrain.map(cell => cell.position.z));
    const anchors = cells.filter(cell => cell.anchor);
    assert.ok(anchors.length > 0 && anchors.length < terrain.length / 10);
    assert.ok(anchors.every(cell => cell.role === 'terrain' && cell.position.y === -3 &&
      (cell.position.x === minX || cell.position.x === maxX || cell.position.z === minZ || cell.position.z === maxZ)));
    assert.ok(cells.filter(cell => cell.role !== 'terrain').every(cell => !cell.anchor && cell.position.y >= 0));
  });

  test(`${map}: deterministic generation and genuine bridge underpass air`, () => {
    const fixture = createStructuralFixture(map);
    assert.deepEqual(fixture, createStructuralFixture(map));
    const occupancy = new Set(fixture.cells.map(cell => key(cell.position)));
    const bridges = fixture.cells.filter(cell => cell.role === 'bridge');
    const decks = bridges.filter(cell => cell.position.y === 4);
    assert.ok(decks.length >= 33);
    assert.ok(bridges.some(cell => cell.position.y === 0));
    assert.ok(decks.filter(cell => [1, 2, 3].every(y => !occupancy.has(key({ ...cell.position, y })))).length >= 21);
    const bridgeIds = new Set(bridges.map(cell => cell.id));
    const withoutPiers = fixture.cells.filter(cell => !(cell.role === 'bridge' && cell.position.y < 4));
    const afterCut = supported(withoutPiers);
    assert.ok(decks.every(cell => !afterCut.has(cell.id)), 'cut piers must release the actual deck');
    assert.ok(withoutPiers.some(cell => !bridgeIds.has(cell.id) && afterCut.has(cell.id)), 'unrelated supported world remains');
  });

  test(`${map}: tree crowns depend on their trunk, not nearby buildings`, () => {
    const { cells } = createStructuralFixture(map);
    const cut = cells.filter(cell => !(cell.role === 'tree' && cell.material === 'wood' && cell.position.y === 1));
    const roots = supported(cut);
    const crowns = cut.filter(cell => cell.role === 'tree' && cell.position.y > 1);
    assert.ok(crowns.length > 0);
    assert.ok(crowns.every(cell => !roots.has(cell.id)));
    assert.ok(cut.filter(cell => cell.role === 'building').every(cell => roots.has(cell.id)));
  });
}

test('lab: cutting only topsoil beneath the first house releases the house, not the neighboring target', () => {
  const { cells } = createStructuralFixture('lab');
  const house = cells.filter(cell => cell.objectId === 'warm:lab:building-01');
  assert.ok(house.length > 0);
  const minX = Math.min(...house.map(cell => cell.position.x));
  const maxX = Math.max(...house.map(cell => cell.position.x));
  const minZ = Math.min(...house.map(cell => cell.position.z));
  const maxZ = Math.max(...house.map(cell => cell.position.z));
  const cut = cells.filter(cell => !(cell.role === 'terrain' && cell.position.y === -1 &&
    cell.position.x >= minX && cell.position.x <= maxX && cell.position.z >= minZ && cell.position.z <= maxZ));
  const roots = supported(cut);
  assert.ok(house.every(cell => !roots.has(cell.id)));
  assert.ok(cut.filter(cell => cell.objectId === 'warm:lab:building-02').every(cell => roots.has(cell.id)));
  assert.ok(cut.filter(cell => cell.anchor).every(cell => roots.has(cell.id)));
});

test('lab: removing foundations cannot leave an implicitly anchored building', () => {
  const { cells } = createStructuralFixture('lab');
  assert.ok(cells.some(cell => cell.objectId === 'warm:lab:building-01' && cell.role === 'foundation'));
  const cut = cells.filter(cell => !(cell.objectId === 'warm:lab:building-01' && cell.role === 'foundation'));
  const roots = supported(cut);
  assert.ok(cut.filter(cell => cell.objectId === 'warm:lab:building-01').every(cell => !roots.has(cell.id)));
});
