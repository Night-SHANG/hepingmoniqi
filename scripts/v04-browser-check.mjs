import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { tsImport } from 'tsx/esm/api';

// Only the independent Node prediction world is mutated below. Browser gameplay
// is driven by actual pointer, keyboard and visible form controls. __heping and
// DOM evaluation are read-only: no save injection, timers or hidden game calls.
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);
const { createProjectilePhysics } = await tsImport('../src/physics.ts', import.meta.url);
const WIDTH = 1440, HEIGHT = 900, MAX_CANDIDATES = 18, MAX_MAIN_ROUNDS = 8, MAX_FREE_SHOTS = 30;
const camera = new THREE.PerspectiveCamera(42, WIDTH / HEIGHT, .2, 250);
camera.position.set(27, 23, 32); camera.lookAt(0, 4.5, 0); camera.updateMatrixWorld();
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
const xyz = p => ({ x: p.x, y: p.y, z: p.z });
const distance = (a, b) => vec(a).distanceTo(vec(b));
function project(p) { const n = vec(p).project(camera); return { x: (n.x + 1) * WIDTH / 2, y: (1 - n.y) * HEIGHT / 2, z: n.z }; }
function origin(target) {
  const d = vec(target).sub(camera.position).normalize(), range = camera.position.distanceTo(vec(target));
  const forward = Math.min(8, range * .25), scale = forward / 8;
  return xyz(camera.position.clone().addScaledVector(d, forward)
    .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), 1.1 * scale)
    .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), -2 * scale));
}
function candidates(snapshot, all = false) {
  const geometry = new THREE.BoxGeometry(.965, .965, .965), material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, snapshot.voxels.length), matrix = new THREE.Matrix4();
  snapshot.voxels.forEach((v, i) => mesh.setMatrixAt(i, matrix.makeTranslation(v.position.x, v.position.y, v.position.z)));
  mesh.computeBoundingSphere(); mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(), seen = new Set(), result = [];
  try {
    for (const voxel of snapshot.voxels) {
      if (!all && voxel.group !== 'house') continue;
      const screen = project(voxel.position);
      if (screen.z < -1 || screen.z > 1 || screen.x < 330 || screen.x > WIDTH - 150 || screen.y < 190 || screen.y > HEIGHT - 170) continue;
      ray.setFromCamera(new THREE.Vector2(screen.x / WIDTH * 2 - 1, 1 - screen.y / HEIGHT * 2), camera);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit || hit.instanceId === undefined) continue;
      const host = snapshot.voxels[hit.instanceId];
      if ((!all && host.group !== 'house') || seen.has(host.id)) continue;
      seen.add(host.id);
      const nearby = all ? 0 : snapshot.voxels.filter(v => v.group === 'house' && distance(v.position, hit.point) < 4.8).length;
      result.push({ screen, surface: { position: xyz(hit.point), normal: xyz(hit.face.normal), voxelId: host.id }, heuristic: nearby + (host.position.y <= 3 ? 35 : 0) });
    }
  } finally { mesh.dispose(); geometry.dispose(); material.dispose(); }
  if (all) return result;
  const chosen = [];
  for (const plan of result.sort((a, b) => b.heuristic - a.heuristic)) {
    if (!chosen.some(p => distance(p.surface.position, plan.surface.position) < 2.3)) chosen.push(plan);
    if (chosen.length >= MAX_CANDIDATES) break;
  }
  return chosen;
}
async function rankShots(snapshot, weapon, power = 1) {
  const plans = candidates(snapshot), physics = await createProjectilePhysics(), prediction = createWorld();
  try {
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index], epoch = snapshot.epoch + index + 1;
      physics.syncVoxels(snapshot.voxels, epoch);
      let event;
      if (weapon === 'shock') {
        assert.ok(physics.attach({ id: `predict-${index}`, epoch, surface: plan.surface, weapon, power }));
        event = physics.detonateAttached()[0];
      } else {
        assert.ok(physics.launch({ id: `predict-${index}`, epoch, origin: origin(plan.surface.position), target: plan.surface.position, weapon, power, trigger: 'automatic' }));
        for (let step = 0; step < 1440 && !event; step++) event = physics.step(1 / 120)[0];
      }
      if (!event) { plan.score = -1; continue; }
      assert.ok(prediction.restore(snapshot), 'Independent native predictor must restore the observed snapshot');
      const before = prediction.getObjective().destroyed;
      const result = prediction.damage({ id: `damage-${index}`, epoch: prediction.epoch, target: event.position, weapon, power });
      plan.expectedBuilding = prediction.getObjective().destroyed - before;
      plan.expectedResearch = result.researchEarned;
      plan.event = event;
      plan.score = plan.expectedBuilding * 1000 + result.researchEarned * 10 + result.newlyDestroyed;
    }
    return plans.sort((a, b) => b.score - a.score);
  } finally { physics.dispose(); }
}
const chooseWeapon = snapshot => snapshot.research >= 90 ? 'shock' : snapshot.research >= 40 ? 'pulse' : 'charge';

// The restricted authoring environment may run ONLY this native branch. The real
// browser branch runs on the project's authorized standard Ubuntu Chrome CI.
if (process.env.PREFLIGHT_ONLY) {
  const world = createWorld(), report = [];
  for (let attempt = 0; attempt < MAX_MAIN_ROUNDS && world.getSnapshot().research < 120; attempt++) {
    for (let shot = 0; shot < 6; shot++) {
      const snapshot = world.getSnapshot(), weapon = chooseWeapon(snapshot), power = attempt === 0 && shot === 0 ? .25 : 1;
      const plan = (await rankShots(snapshot, weapon, power))[0];
      assert.ok(plan?.score > 0, `Native growth predictor stalled: ${JSON.stringify(world.getObjective())}`);
      assert.ok(world.recordShot());
      world.damage({ id: `preflight-${attempt}-${shot}`, epoch: world.epoch, target: plan.event.position, weapon, power });
      report.push({ attempt: attempt + 1, shot: shot + 1, weapon, research: world.getSnapshot().research, fraction: world.getObjective().fraction });
      if (world.getSnapshot().research >= 120) break;
    }
    if (world.getSnapshot().research < 120) { world.finishRound(); world.reset(); }
  }
  assert.ok(world.getSnapshot().research >= 120, '120 research must be reachable within bounded real six-shot attempts');
  const thresholdRoutes = [];
  for (const map of ['courtyard', 'warehouse']) {
    assert.ok(world.loadMap(map)); let shots = 0;
    for (let shot = 0; shot < MAX_FREE_SHOTS && world.getObjective().fraction < .7; shot++) {
      shots++;
      const plan = (await rankShots(world.getSnapshot(), 'shock'))[0];
      assert.ok(plan?.score > 0, `Native 70% predictor stalled on ${map}`);
      world.damage({ id: `native-free-${map}-${shot}`, epoch: world.epoch, target: plan.event.position, weapon: 'shock', power: 1, reward: false });
    }
    assert.ok(world.getObjective().fraction >= .7, `${map} has a bounded real-input route past 70%`);
    if (map === 'courtyard') assert.ok(shots <= 6, 'Unlocked main mode can cross 70% within its six-round budget');
    thresholdRoutes.push({ map, shots, fraction: world.getObjective().fraction });
  }
  console.log(JSON.stringify({ status: 'native-preflight-passed', report, thresholdRoutes }, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.setDefaultTimeout(20000);
const errors = [], evidence = { checks: [], shots: [], screenshots: [] }, output = 'artifacts/v04-browser';
page.on('pageerror', error => errors.push(String(error)));
await fs.mkdir(output, { recursive: true });
const read = () => page.evaluate(() => ({
  snapshot: window.__heping.snapshot(), objective: window.__heping.objective(), round: window.__heping.round(),
  projectiles: window.__heping.projectiles(), detonations: window.__heping.lastDetonations(), preview: window.__heping.preview(),
  target: window.__heping.target, weapon: window.__heping.weapon, flow: window.__heping.flow,
  activeEffects: window.__heping.activeEffects, renderedProjectiles: window.__heping.renderedProjectiles, sandbox: window.__heping.sandbox,
  paused: document.querySelector('#pause').classList.contains('active'), slow: document.querySelector('#slow').classList.contains('active'),
  modal: document.querySelector('#completion-dialog').open,
}));
const compact = s => ({ research: s.snapshot.research, destroyed: s.snapshot.destroyedCount, epoch: s.snapshot.epoch, objective: s.objective, round: s.round, projectiles: s.projectiles, detonations: s.detonations, preview: s.preview, target: s.target, weapon: s.weapon, flow: s.flow, activeEffects: s.activeEffects, renderedProjectiles: s.renderedProjectiles, sandbox: s.sandbox, paused: s.paused, modal: s.modal });
function record(name, detail) { evidence.checks.push({ name, ...detail }); console.log(`V04_PROGRESS ${JSON.stringify(evidence.checks.at(-1))}`); }
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50, scale: 'css' });
  assert.ok(jpg.length <= 220000, `Evidence JPEG must fit 220 KB: ${name} is ${jpg.length}`);
  await fs.writeFile(`${output}/${name}.jpg`, jpg);
  evidence.screenshots.push({ name, bytes: jpg.length, quality: 50 });
  if (process.env.CI) console.log(`SCREENSHOT_BASE64 v04-${name} ${jpg.toString('base64')}`);
}
async function waitFor(test, arg, label, timeout = 60000) {
  try { await page.waitForFunction(test, arg, { timeout }); }
  catch (error) { throw new Error(`${label}: ${String(error)}; current=${JSON.stringify(compact(await read()))}`); }
}
async function waitEvent(id) {
  await waitFor(id => window.__heping.lastDetonations().some(event => event.id === id), id, `Detonation ${id}`);
  return (await read()).detonations.find(event => event.id === id);
}
async function idle() { await waitFor(() => !window.__heping.activeEffects && window.__heping.projectiles().length === 0, null, 'Effects and ordnance settle', 120000); }
async function noAutoSummary(label) {
  const state = await read(); assert.equal(state.flow, 'active', `${label}: no automatic settlement`);
  assert.equal(state.paused, false, `${label}: no automatic pause`); assert.equal(state.modal, false, `${label}: no automatic modal`);
  return state;
}
async function setSandbox(enabled) {
  await page.locator('#settings').click(); await page.locator('#sandbox').setChecked(enabled); await page.locator('.done').click();
  assert.equal((await read()).sandbox, enabled);
}
async function select(weapon) { await page.locator(`[data-weapon="${weapon}"]`).click(); assert.equal((await read()).weapon, weapon); }
async function settings(delivery, trigger = 'automatic', power = 100) {
  await page.locator('#delivery').selectOption(delivery);
  if (delivery !== 'place') await page.locator('#trigger').selectOption(trigger);
  // A keyboard-operated range is a real user input, not a DOM property write.
  await page.locator('#power').focus(); await page.keyboard.press(power === 25 ? 'Home' : 'End');
  assert.equal(await page.locator('#power').inputValue(), String(power));
}
async function clickPlan(plan) {
  const { x, y } = plan.screen;
  if (!await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('canvas'), { x, y })) return false;
  await page.mouse.click(x, y); const state = await read();
  return state.target !== null && distance(state.target, plan.surface.position) < .12;
}
async function aim(weapon, power = 1, allowHarmless = false) {
  const plans = await rankShots((await read()).snapshot, weapon, power);
  for (const plan of plans) if ((plan.score > 0 || allowHarmless) && await clickPlan(plan)) return plan;
  if (allowHarmless) { const ground = await aimGround(); return { surface: { position: ground.target }, expectedBuilding: 0, expectedResearch: 0 }; }
  throw new Error(`No useful real-pointer aim for ${weapon}: ${JSON.stringify(compact(await read()))}`);
}
async function aimGround() {
  for (let z = 15; z >= -13; z -= 4) for (let x = -19; x <= 19; x += 4) {
    const target = { x, y: 0, z }, screen = project(target);
    if (screen.x < 330 || screen.x > WIDTH - 150 || screen.y < 200 || screen.y > HEIGHT - 175) continue;
    if (await clickPlan({ screen, surface: { position: target } })) return { target, screen };
  }
  throw new Error('Could not select exposed ground by real pointer input');
}
async function aimRoof() {
  const snapshot = (await read()).snapshot, byId = new Map(snapshot.voxels.map(v => [v.id, v]));
  const plans = candidates(snapshot, true).filter(plan => {
    const host = byId.get(plan.surface.voxelId);
    return host.group === 'house' && host.material === 'roof' && Math.abs(host.position.x) < 4 && Math.abs(host.position.z) < 5;
  }).sort((a, b) => Math.hypot(a.screen.x - WIDTH / 2, a.screen.y - HEIGHT / 2) - Math.hypot(b.screen.x - WIDTH / 2, b.screen.y - HEIGHT / 2));
  for (const plan of plans) if (await clickPlan(plan)) return plan;
  throw new Error('No exposed central roof target for real repeat-through-hole regression');
}
async function visibleRocket(name) {
  await page.locator('#slow').click();
  const fired = await execute(); await page.locator('#pause').click();
  const frozen = await read(), body = frozen.projectiles.find(p => p.id === fired.id);
  assert.ok(body, 'Rocket remains physically present for its flight evidence');
  assert.ok(body.velocity && Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) > 0, 'Visible rocket has physical orientation velocity');
  const screen = project(body.position);
  assert.ok(screen.z > -1 && screen.z < 1 && screen.x > 30 && screen.x < WIDTH - 30 && screen.y > 100 && screen.y < HEIGHT - 130, 'Rocket body is inside the usable canvas');
  assert.ok(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('canvas'), screen), 'Actual rocket body is not hidden under controls');
  if (name) await capture(name);
  await page.locator('#slow').click(); await page.locator('#pause').click();
  const event = await waitEvent(fired.id); assert.equal(event.reason, 'impact');
  return { body, event };
}
async function execute() {
  const before = await read(); await page.locator('#fire').click(); const after = await read();
  const body = after.projectiles.find(p => !before.projectiles.some(q => q.id === p.id));
  assert.ok(body, 'The real fire/confirm button creates an observable physical object');
  assert.equal(after.snapshot.destroyedCount, before.snapshot.destroyedCount, 'Launch/placement cannot apply immediate damage');
  assert.equal(after.round.used, before.round.used + (after.sandbox ? 0 : 1), 'Only accepted main-mode execution consumes one round');
  return body;
}
async function shootBest(weapon, power = 100, allowHarmless = false) {
  await select(weapon); await settings(weapon === 'shock' ? 'place' : 'quick', 'automatic', power);
  const before = await read(), plan = await aim(weapon, power / 100, allowHarmless), body = await execute();
  if (weapon === 'shock') await page.locator('#detonate').click();
  const event = await waitEvent(body.id), after = await noAutoSummary('After actual damage');
  const detail = { map: after.objective.mapId, sandbox: after.sandbox, weapon, used: after.round.used, research: after.snapshot.research, fraction: after.objective.fraction, expectedBuilding: plan.expectedBuilding, actualBuilding: after.objective.destroyed - before.objective.destroyed, event };
  evidence.shots.push(detail); console.log(`V04_SHOT ${JSON.stringify(detail)}`);
  return after;
}
async function finishRound(expectEffects = false) {
  const before = await read(); if (expectEffects) assert.equal(before.activeEffects, true, 'Explicit finish starts while explosion effects are still active');
  await page.locator('#finish-round').click(); const pending = await read();
  assert.equal(pending.paused, false, 'Finishing must not freeze a live explosion');
  if (expectEffects) { assert.equal(pending.flow, 'ending'); assert.equal(pending.modal, false, 'No result modal in the explosion frame'); }
  await waitFor(() => document.querySelector('#completion-dialog').open, null, 'Explicit settlement result', 120000);
  const settled = await read(); assert.equal(settled.flow, 'settled'); assert.equal(settled.round.settled, true);
  assert.equal(settled.activeEffects, false); assert.equal(settled.projectiles.length, 0); assert.equal(settled.paused, false);
  return { before: compact(before), pending: compact(pending), settled: compact(settled) };
}
async function retry() {
  const prior = await read(); await page.locator('#retry-map').click(); const fresh = await read();
  assert.equal(fresh.round.used, 0); assert.equal(fresh.round.budget, 6); assert.equal(fresh.round.settled, false);
  assert.equal(fresh.snapshot.research, prior.snapshot.research); assert.equal(fresh.objective.destroyed, 0);
  assert.equal(fresh.projectiles.length, 0); assert.equal(fresh.flow, 'active'); assert.equal(fresh.modal, false);
  return fresh;
}
async function verifyUnlocks(state) {
  const research = state.snapshot.research;
  for (const [weapon, threshold] of [['pulse', 40], ['shock', 90]]) {
    await select('charge'); await page.locator(`[data-weapon="${weapon}"]`).click();
    assert.equal((await read()).weapon, research >= threshold ? weapon : 'charge', `${weapon} unlock threshold is ${threshold} main research`);
  }
  assert.equal(await page.locator('#map-warehouse').isDisabled(), research < 120, 'Main warehouse unlock threshold is 120 research');
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5191', { waitUntil: 'networkidle' });
  await waitFor(() => window.__heping?.physicsReady, null, 'Physics startup');
  await page.locator('#dismiss-intro').click();
  const initial = await read();
  assert.equal(initial.snapshot.research, 0); assert.equal(initial.round.budget, 6); assert.equal(initial.round.used, 0);
  assert.equal(initial.objective.mapId, 'courtyard'); await verifyUnlocks(initial);
  await capture('01-main-six-rounds');

  // Free maps are selectable, but free mode is not an unlock or research cheat.
  await setSandbox(true);
  for (const weapon of ['pulse', 'shock']) { await page.locator(`[data-weapon="${weapon}"]`).click(); assert.equal((await read()).weapon, 'charge'); }
  assert.equal(await page.locator('#map-warehouse').isDisabled(), false);
  await page.locator('#map-warehouse').click(); assert.equal((await read()).objective.mapId, 'warehouse');
  await page.locator('#map-courtyard').click(); assert.equal((await read()).objective.mapId, 'courtyard');
  assert.match(await page.locator('#ammo').innerText(), /∞/); assert.equal(await page.locator('#finish-round').isHidden(), true);
  await settings('place');
  const ground = await aimGround(), first = await execute();
  assert.equal(first.state, 'attached'); assert.equal(first.hostVoxelId, null, 'Ground placement is supported');
  assert.equal(first.trigger, 'remote'); assert.equal(first.fuseRemaining, null);
  const placementPlans = candidates((await read()).snapshot, true);
  let placed = 1;
  for (const plan of placementPlans) {
    if (placed === 60) break;
    if (!await clickPlan(plan)) continue;
    await execute(); placed++;
  }
  assert.equal(placed, 60, 'At least sixty distinct visible placements can be made by real input');
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age > 3.2), first.id, 'Placed grenade remains armed beyond automatic fuse');
  const sixty = await read();
  assert.equal(sixty.projectiles.length, 60); assert.equal(sixty.renderedProjectiles, 60, 'No renderer truncation at old 8/48-object capacities');
  assert.equal(sixty.detonations.length, 0); assert.equal(sixty.snapshot.research, 0); assert.equal(sixty.round.used, 0);
  assert.ok(sixty.projectiles.every(p => p.state === 'attached' && p.trigger === 'remote' && p.fuseRemaining === null));
  evidence.sixtyPlaced = compact(sixty); await capture('02-sixty-physical-visible-grenades');
  const placedIds = sixty.projectiles.map(p => p.id); await page.locator('#detonate').click();
  await waitFor(ids => ids.every(id => window.__heping.lastDetonations().some(e => e.id === id && e.reason === 'remote')), placedIds, 'All sixty manual detonations');
  const detonated = await read(); assert.equal(detonated.projectiles.length, 0); assert.equal(detonated.renderedProjectiles, 0);
  assert.equal(detonated.detonations.length, 60); assert.equal(detonated.snapshot.research, 0);
  assert.ok(detonated.snapshot.destroyedCount > 0, 'Free damage really occurs without granting research');
  record('free-mode-locks-maps-and-sixty-placements', { ground, physical: 60, rendered: 60, manualDetonations: 60 });
  await setSandbox(false);
  const freeRestored = await read(); assert.deepEqual(freeRestored.snapshot.voxels, initial.snapshot.voxels);
  assert.deepEqual(freeRestored.round, initial.round); assert.equal(freeRestored.snapshot.research, 0);

  // Preview spends nothing; first confirmed live body matches a separately run
  // Rapier simulation of the observed command, not a straight-line approximation.
  await settings('preview', 'automatic', 25); await select('charge'); await aim('charge', .25);
  await page.locator('#slow').click();
  const previewBefore = await read(); await page.locator('#fire').click(); const previewed = await read();
  assert.ok(previewed.preview?.points.length > 3); assert.equal(previewed.projectiles.length, 0);
  assert.deepEqual(previewed.round, previewBefore.round); assert.deepEqual(previewed.snapshot, previewBefore.snapshot);
  assert.ok(distance(previewed.preview.points[0], origin(previewed.target)) < .01);
  evidence.preview = { points: previewed.preview.points, duration: previewed.preview.duration, impact: previewed.preview.impact };
  await capture('03-preview-before-ammo-spend');
  const confirmed = await execute(); assert.equal((await read()).preview, null);
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age >= .05), confirmed.id, 'First actual trajectory sample');
  await page.locator('#pause').click(); const frozen = await read(), body = frozen.projectiles.find(p => p.id === confirmed.id);
  assert.ok(body && body.age < previewed.preview.duration, 'A visible actual sample precedes preview contact');
  const native = await createProjectilePhysics();
  try {
    native.syncVoxels(previewBefore.snapshot.voxels, previewBefore.snapshot.epoch);
    assert.ok(native.launch({ id: body.id, epoch: previewBefore.snapshot.epoch, origin: previewed.preview.points[0], target: previewed.target, weapon: 'charge', power: .25, trigger: 'automatic' }));
    for (let step = 0; step < Math.round(body.age * 120); step++) native.step(1 / 120);
    const predicted = native.getProjectiles()[0]; assert.ok(predicted); assert.ok(distance(body.position, predicted.position) < .025, 'Confirmed first trajectory matches real preview physics');
    const previewIndex = Math.floor(body.age * 30), previewFraction = body.age * 30 - previewIndex;
    const left = previewed.preview.points[previewIndex], right = previewed.preview.points[previewIndex + 1];
    assert.ok(left && right, 'Preview contains the actual early-flight sample');
    const drawnPoint = xyz(vec(left).lerp(vec(right), previewFraction));
    assert.ok(distance(body.position, drawnPoint) < .03, 'Actual early trajectory follows the points shown in the preview');
    evidence.trajectoryMatch = { age: body.age, actual: body.position, predicted: predicted.position, drawnPoint, error: distance(body.position, predicted.position), previewError: distance(body.position, drawnPoint) };
  } finally { native.dispose(); }
  assert.ok(body.rotation && Math.abs(body.rotation.w - 1) > .00001, 'Physical grenade spins');
  assert.ok(body.fuseRemaining > 0 && body.fuseRemaining < 3);
  await page.waitForTimeout(700);
  const pauseCheck = await read();
  assert.deepEqual(pauseCheck.projectiles, frozen.projectiles, 'Real pause freezes position, rotation, age and fuse');
  assert.deepEqual(pauseCheck.detonations, frozen.detonations, 'Real pause emits no delayed explosion');
  await capture('04-confirmed-live-trajectory');
  await page.locator('#slow').click(); await page.locator('#pause').click();
  assert.equal((await waitEvent(confirmed.id)).reason, 'timer');
  const lowDamage = await noAutoSummary('Low-damage experiment');
  assert.ok(lowDamage.snapshot.research > 0 && lowDamage.objective.fraction < .7, 'Research is awarded before any 70% objective');
  assert.equal(lowDamage.round.used, 1); record('low-damage-earns-research', { research: lowDamage.snapshot.research, fraction: lowDamage.objective.fraction });

  await page.reload({ waitUntil: 'networkidle' }); await waitFor(() => window.__heping?.physicsReady, null, 'Reload physics');
  const reloaded = await read(); assert.equal(reloaded.round.used, 1); assert.equal(reloaded.round.budget, 6);
  assert.equal(reloaded.snapshot.research, lowDamage.snapshot.research); assert.deepEqual(reloaded.snapshot.voxels, lowDamage.snapshot.voxels);
  await page.locator('#dismiss-intro').click(); record('reload-preserves-spent-ammunition', { used: reloaded.round.used });

  // Genuine six-shot rounds plus deliberate retry unlock both tools and map.
  for (let attempt = 0; attempt < MAX_MAIN_ROUNDS; attempt++) {
    while ((await read()).round.used < 6) {
      const before = await read(); const after = await shootBest(chooseWeapon(before.snapshot), 100, true);
      await verifyUnlocks(after);
    }
    const exhausted = await read(); assert.equal(exhausted.round.used, 6); assert.equal(await page.locator('#fire').isDisabled(), true);
    await page.keyboard.press('Space'); const blocked = await read();
    assert.equal(blocked.round.used, 6); assert.equal(blocked.projectiles.length, exhausted.projectiles.length, 'Seventh shot cannot bypass budget');
    const summary = await finishRound(); evidence.rounds ??= []; evidence.rounds.push(summary);
    if (attempt === 0) await capture('05-explicit-round-summary');
    const fresh = await retry(); record('six-ammo-round-and-retry', { attempt: attempt + 1, research: fresh.snapshot.research, refilled: fresh.round.budget - fresh.round.used });
    if (fresh.snapshot.research >= 120) break;
  }
  const unlocked = await read(); assert.ok(unlocked.snapshot.research >= 120, 'Real actions reach 40/90/120 research unlocks within the bounded attempt budget');
  await verifyUnlocks(unlocked); await page.locator('#map-warehouse').click();
  const warehouse = await read(); assert.equal(warehouse.objective.mapId, 'warehouse'); assert.equal(warehouse.round.used, 0);
  assert.equal(warehouse.snapshot.research, unlocked.snapshot.research); await capture('06-warehouse-unlocked-by-research');
  await page.locator('#map-courtyard').click();

  // Preserve the former projectile acceptance's live-geometry invariant after
  // genuinely earning the rocket unlock. Repeating exactly the same real aim
  // must pass through a removed roof instead of colliding with a stale collider.
  await setSandbox(true); await select('pulse'); await settings('quick');
  const roofPlan = await aimRoof(), roofBefore = await read();
  const firstRocket = await visibleRocket('07-rocket-real-flight');
  assert.ok((await read()).snapshot.destroyedCount > roofBefore.snapshot.destroyedCount);
  const secondRocket = await visibleRocket();
  assert.ok(secondRocket.event.position.y < firstRocket.event.position.y - .5, 'Second rocket passes the newly destroyed roof at the unchanged aim');
  evidence.roofHole = { aim: roofPlan.surface.position, first: firstRocket, second: secondRocket };
  await capture('08-repeat-rocket-through-live-roof-hole');
  await page.locator('#reset').click();

  // Launched remote ordnance must survive both a collision and the usual fuse.
  await select('charge'); await settings('quick', 'remote'); await aim('charge');
  const remote = await execute();
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age >= 12.5), remote.id, 'Remote launched grenade survives normal fuse and automatic lifetime cleanup');
  const remoteArmed = await read(), remoteBody = remoteArmed.projectiles.find(p => p.id === remote.id);
  assert.equal(remoteBody.trigger, 'remote'); assert.equal(remoteBody.fuseRemaining, null); assert.equal(remoteBody.state, 'flying');
  assert.ok(!remoteArmed.detonations.some(e => e.id === remote.id)); await capture('09-launched-remote-still-armed');
  await page.locator('#detonate').click(); assert.equal((await waitEvent(remote.id)).reason, 'remote');
  const mainResearch = unlocked.snapshot.research;
  assert.equal((await read()).snapshot.research, mainResearch);
  await page.locator('#reset').click();
  await select('shock'); await settings('place');
  const packagePlans = candidates((await read()).snapshot, true), packageIds = [];
  for (const plan of packagePlans) { if (packageIds.length === 9) break; if (await clickPlan(plan)) packageIds.push((await execute()).id); }
  assert.equal(packageIds.length, 9); const ninePackages = await read();
  assert.equal(ninePackages.projectiles.filter(p => p.weapon === 'shock' && p.state === 'attached').length, 9);
  assert.equal(ninePackages.renderedProjectiles, 9, 'Remote packages themselves exceed the old eight-package limit');
  await capture('07b-nine-remote-packages'); await page.locator('#detonate').click();
  await waitFor(ids => ids.every(id => window.__heping.lastDetonations().some(e => e.id === id)), packageIds, 'Nine packages all detonate');
  record('remote-package-count-exceeds-eight', { placed: 9, rendered: 9, detonated: 9 });
  for (let shot = 0; shot < MAX_FREE_SHOTS && (await read()).objective.fraction < .7; shot++) await shootBest('shock');
  const overSeventy = await noAutoSummary('At least 70% building destruction');
  assert.ok(overSeventy.objective.fraction >= .7); assert.equal(overSeventy.snapshot.research, mainResearch);
  await page.waitForTimeout(1200); await noAutoSummary('70% remains freely playable');
  evidence.overSeventy = compact(await read()); await capture('10-seventy-percent-without-auto-result');
  await setSandbox(false); const restoredMain = await read(); assert.equal(restoredMain.snapshot.research, mainResearch);
  assert.equal(restoredMain.objective.destroyed, 0); assert.equal(restoredMain.round.used, 0);

  // The player explicitly requests results during an explosion, and only gets
  // them after the live cosmetic effect has finished. Armed objects auto-trigger
  // once as part of that explicitly requested ending operation.
  // A main-only automatic 70% regression must not hide behind free-mode tests.
  for (let shot = 0; shot < 6 && (await read()).objective.fraction < .7; shot++) await shootBest('shock');
  const mainSeventy = await noAutoSummary('Main mode at least 70%');
  assert.equal(mainSeventy.sandbox, false);
  assert.ok(mainSeventy.objective.fraction >= .7, 'Unlocked main round passes 70% within six real shots without an automatic result');
  assert.ok(mainSeventy.round.used <= 6); evidence.mainOverSeventy = compact(mainSeventy);
  evidence.effectSettlement = await finishRound(true); await capture('11-effects-finished-before-summary'); await retry();
  await select('charge'); await settings('place'); await aimGround(); const settleRemote = await execute();
  await page.locator('#finish-round').click(); const armedEnding = await read();
  assert.equal(armedEnding.flow, 'ending'); assert.equal(armedEnding.modal, false); assert.equal(armedEnding.paused, false);
  assert.equal(armedEnding.projectiles.length, 0); assert.equal(armedEnding.detonations.filter(e => e.id === settleRemote.id).length, 1);
  assert.equal(armedEnding.detonations.find(e => e.id === settleRemote.id).reason, 'remote');
  await waitFor(() => document.querySelector('#completion-dialog').open, null, 'Explicit ending triggers remote then settles', 120000); await retry();

  // Reset invalidates an ending with an automatic fuse still in flight.
  await select('charge'); await settings('quick'); await aim('charge'); await page.locator('#slow').click();
  const cancelled = await execute(); await page.locator('#finish-round').click();
  const ending = await read(); assert.equal(ending.flow, 'ending'); assert.equal(ending.modal, false);
  await page.locator('#reset').click(); const reset = await read();
  assert.equal(reset.flow, 'active'); assert.equal(reset.projectiles.length, 0); assert.equal(reset.renderedProjectiles, 0);
  assert.equal(reset.round.used, 0); assert.equal(reset.modal, false); assert.equal(reset.activeEffects, false);
  await page.waitForTimeout(4200); const later = await read();
  assert.equal(later.snapshot.destroyedCount, 0); assert.equal(later.snapshot.research, reset.snapshot.research);
  assert.equal(later.modal, false); assert.equal(later.flow, 'active'); assert.ok(!later.detonations.some(e => e.id === cancelled.id));
  record('reset-cancels-flight-and-pending-result', { cancelledId: cancelled.id, epoch: later.snapshot.epoch });

  await settings('place'); // Empty remote placement mode intentionally exposes its detonator.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#settings').click(); await page.locator('.done').click(); await select('shock');
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    controls: ['settings', 'pause', 'reset', 'fire', 'detonate', 'delivery', 'trigger', 'finish-round', 'map-courtyard', 'map-warehouse'].map(id => {
      const element = document.getElementById(id), r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id, reachable: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && (hit === element || element.contains(hit)) };
    }),
  }));
  await capture('12-mobile-landscape-controls'); assert.equal(mobile.overflow, false); assert.ok(mobile.controls.every(c => c.reachable), JSON.stringify(mobile));
  evidence.mobile = mobile; assert.deepEqual(errors, []); evidence.final = compact(await read()); evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = String(error); evidence.current = await read().then(compact).catch(() => null);
  await capture('failure').catch(captureError => { evidence.captureFailure = String(captureError); });
  throw error;
} finally {
  evidence.errors = errors; await fs.writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2)); await browser.close();
}
