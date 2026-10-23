import assert from 'node:assert/strict';
export { overlaps, assertInsideViewport, assertStationary, assertSideComposition } from './v07-qa-contract.mjs';
export const WEAPON_IDS = ['charge', 'pulse', 'shock', 'echo', 'split', 'phase', 'heavy', 'nova'];
export const MAP_IDS = ['courtyard', 'warehouse', 'bridge', 'tower', 'cantilever', 'neighborhood', 'city'];
export const BUILDING_COUNTS = { neighborhood: 9, city: 36 };
export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE_LANDSCAPE = { width: 844, height: 390 };
export const OPERATION_CONTROLS = ['[data-delivery="quick"]', '[data-delivery="place"]', '[data-trigger="automatic"]', '[data-trigger="remote"]', '#power', '#fire', '#detonate'];
export function distinctBuildings(voxels) {
  const houses = voxels.filter(v => v.group === 'house');
  assert.ok(houses.every(v => typeof v.objectId === 'string' && v.objectId.length), 'Every house cell needs a stable building identity');
  return [...new Set(houses.map(v => v.objectId))].sort();
}
export function damagedBuildings(before, after) {
  const current = new Map(after.map(v => [v.id,v]));
  return [...new Set(before.filter(v => v.group === 'house' && (!current.has(v.id) || current.get(v.id).hp < v.hp)).map(v => v.objectId))].sort();
}
export function assertAudioBudget(audio) {
  assert.ok(audio && Array.isArray(audio.activeVoices), 'Audio diagnostics must expose active voices');
  assert.ok(Number.isInteger(audio.maxVoices) && audio.maxVoices > 0, 'Audio diagnostics must expose a positive voice budget');
  assert.ok(audio.activeVoices.length <= audio.maxVoices, 'Audio voice budget exceeded');
  assert.equal(new Set(audio.activeVoices.map(v => v.voiceId)).size, audio.activeVoices.length, 'Duplicate active audio source identity');
}
