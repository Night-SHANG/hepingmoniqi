import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createSchema5Fixture, createOverLimitSchema6Fixture } from './v07-qa-fixtures.mjs';
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);
const { requiresLoadoutReselection } = await tsImport('../src/gameplay.ts', import.meta.url);

test('schema5 browser fixture is damaged and valid, preserves research/stock and appends only zeros', () => {
  const save = createSchema5Fixture(createWorld), restored = createWorld();
  assert.ok(save.destroyedCount > 0); assert.equal(save.schemaVersion, 5); assert.equal(restored.restore(save), true);
  const next = restored.getSnapshot(); assert.equal(next.schemaVersion, 7); assert.equal(next.research, 420); assert.deepEqual(next.voxels, save.voxels);
  assert.deepEqual(restored.getRound(), { ...save.round, loadout: { ...save.round.loadout, echo: 0, split: 0, phase: 0 }, remaining: { ...save.round.remaining, echo: 0, split: 0, phase: 0 } });
  assert.equal(requiresLoadoutReselection(restored.getRound()), false);
});
test('schema6 over-limit browser fixture restores without truncation and requires explicit reselect', () => {
  const save = createOverLimitSchema6Fixture(createWorld), restored = createWorld();
  assert.ok(save.destroyedCount > 0); assert.equal(restored.restore(save), true);
  const next = restored.getSnapshot(); assert.equal(next.schemaVersion, 7); assert.equal(next.research, 620); assert.deepEqual(next.voxels, save.voxels);
  assert.deepEqual(restored.getRound(), { ...save.round, loadout: { ...save.round.loadout, phase: 0 }, remaining: { ...save.round.remaining, phase: 0 } });
  assert.equal(requiresLoadoutReselection(restored.getRound()), true);
  assert.equal(restored.recordShot('echo'), false);
  assert.equal(restored.startRound('cantilever', { charge: 1, pulse: 0, shock: 0, echo: 1, split: 0, phase: 2 }), true);
  assert.equal(restored.getSnapshot().research, 620); assert.equal(restored.getRound().budget, 10);
});
