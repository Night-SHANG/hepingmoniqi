import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { BUILDING_COUNTS, WEAPON_IDS, MAP_IDS, distinctBuildings, damagedBuildings, assertAudioBudget } from './v08-qa-contract.mjs';
import { createSchema7Fixture } from './v08-qa-fixtures.mjs';
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);

test('v08 QA explicitly covers seven maps and eight tools, with nine and thirty-six real building identities', () => {
  assert.equal(MAP_IDS.length, 7); assert.equal(WEAPON_IDS.length, 8);
  assert.deepEqual(BUILDING_COUNTS, { neighborhood: 9, city: 36 });
  assert.deepEqual(distinctBuildings([{id:1,group:'house',objectId:'A'},{id:2,group:'house',objectId:'A'},{id:3,group:'house',objectId:'B'},{id:4,group:'tree',objectId:'C'}]), ['A','B']);
  assert.throws(() => distinctBuildings([{id:1,group:'house'}]), /identity/);
});

test('building damage comparison sees removed cells and surviving HP loss, not decorative objects', () => {
  const before = [{id:1,group:'house',objectId:'A',hp:3},{id:2,group:'house',objectId:'B',hp:3},{id:3,group:'tree',objectId:'C',hp:1}];
  const after = [{...before[1],hp:2}];
  assert.deepEqual(damagedBuildings(before,after), ['A','B']);
  assert.deepEqual(damagedBuildings(before, structuredClone(before)), []);
});

test('schema7 fixture is labelled, genuinely damaged and migrates exact old stock with zero new stock', () => {
  const fixture=createSchema7Fixture(createWorld), world=createWorld();
  assert.equal(fixture.schemaVersion,7); assert.equal(fixture.research,1400);
  assert.ok(fixture.destroyedCount>0); assert.equal(world.restore(fixture),true);
  const actual=world.getSnapshot(); assert.equal(actual.schemaVersion,8);
  for(const key of ['research','destroyedCount','totalCount','mapId','completedMaps','voxels']) assert.deepEqual(actual[key],fixture[key],key);
  assert.deepEqual(actual.round,{...fixture.round,loadout:{...fixture.round.loadout,heavy:0,nova:0},remaining:{...fixture.round.remaining,heavy:0,nova:0}});
  assert.equal(world.restore(actual),true); const again=world.getSnapshot(); assert.ok(again.epoch>actual.epoch); assert.deepEqual({...again,epoch:actual.epoch},actual);
});

test('audio budget assertion rejects overflow and duplicate active source identities', () => {
  assertAudioBudget({activeVoices:[{voiceId:1}],maxVoices:2});
  assert.throws(()=>assertAudioBudget({activeVoices:[{voiceId:1},{voiceId:2}],maxVoices:1}),/budget/);
  assert.throws(()=>assertAudioBudget({activeVoices:[{voiceId:1},{voiceId:1}],maxVoices:2}),/identity/);
});
