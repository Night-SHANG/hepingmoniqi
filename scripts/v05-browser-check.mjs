import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { tsImport } from 'tsx/esm/api';

// Only the independent Node prediction world is mutated below. Browser gameplay
// is driven by actual pointer, keyboard and visible form controls. __heping and
// DOM evaluation are read-only: no save injection, timers or hidden game calls.
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);
const { createProjectilePhysics } = await tsImport('../src/physics.ts', import.meta.url);
const { capacityForResearch, weaponCost, validateLoadout } = await tsImport('../src/gameplay.ts', import.meta.url);
const WIDTH = 1440, HEIGHT = 900, MAX_CANDIDATES = 12, MAX_MAIN_ROUNDS = 8, MAX_FREE_SHOTS = 24;
const WEAPONS = ['charge', 'pulse', 'shock'];
const emptyLoadout = () => ({ charge: 0, pulse: 0, shock: 0 });
const spent = loadout => WEAPONS.reduce((n, id) => n + loadout[id] * weaponCost(id), 0);
const fullLoadout = research => research < 40 ? { charge: 6, pulse: 0, shock: 0 } : research < 90 ? { charge: 0, pulse: 3, shock: 0 } : { charge: 2, pulse: 1, shock: 1 };
const usefulWeapon = state => WEAPONS.slice().reverse().find(id => state.round.remaining[id] > 0);
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

// Native-only preflight is safe in the authoring sandbox. Synthetic fixtures are
// confined to this independent Node world and are NEVER injected into a browser.
async function nativePreflight() {
  assert.deepEqual([0, 119, 120, 10000].map(capacityForResearch), [6, 6, 8, 8]);
  assert.deepEqual(WEAPONS.map(weaponCost), [1, 2, 2]);
  const mixed = { charge: 2, pulse: 1, shock: 1 };
  assert.equal(spent(mixed), 6); assert.equal(validateLoadout(mixed, 90), true);
  for (const bad of [emptyLoadout(), { ...mixed, charge: 3 }, { ...mixed, charge: -1 }, { ...mixed, pulse: .5 }, { ...mixed, shock: Number.MAX_SAFE_INTEGER }]) assert.equal(validateLoadout(bad, 90), false);
  assert.equal(validateLoadout(mixed, 89), false);
  const frozen = createWorld(); assert.ok(frozen.restore({ ...frozen.getSnapshot(), research: 119 }));
  assert.ok(frozen.startRound('courtyard', mixed)); const frozenBefore = frozen.getRound();
  const target = frozen.getSnapshot().voxels.find(v => v.group === 'house' && v.material === 'wood' && v.position.y === 3).position;
  frozen.damage({ id: 'native-threshold', epoch: frozen.epoch, target, weapon: 'shock', power: 1 });
  assert.ok(frozen.getSnapshot().research >= 120); assert.deepEqual(frozen.getRound(), frozenBefore);
  assert.equal(frozen.recordShot('shock'), true); assert.equal(frozen.recordShot('shock'), false);
  assert.equal(frozen.getRound().used, 2); assert.equal(frozen.getRound().remaining.pulse, 1);
  frozen.finishRound(); assert.ok(frozen.startRound('courtyard', { charge: 8, pulse: 0, shock: 0 }));
  assert.equal(frozen.getRound().budget, 8); assert.equal(frozen.getObjective().destroyed, 0);
  const migration = createWorld(), legacy = migration.getSnapshot();
  assert.ok(migration.restore({ ...legacy, schemaVersion: 4, research: 130, round: { budget: 6, used: 5, startResearch: 130, startDestroyed: 0, settled: false } }));
  assert.equal(migration.getRound().budget, 6); assert.deepEqual(migration.getRound().remaining, { charge: 1, pulse: 0, shock: 0 });
  const reloaded = createWorld(); assert.ok(reloaded.restore(migration.getSnapshot())); assert.equal(reloaded.recordShot('pulse'), false); assert.equal(reloaded.recordShot('charge'), true); assert.equal(reloaded.recordShot('charge'), false);
  const immutable = reloaded.getSnapshot(); assert.equal(reloaded.startRound('warehouse', { charge: 9, pulse: 0, shock: 0 }), false); assert.deepEqual(reloaded.getSnapshot(), immutable);
  const isolated = reloaded.getSnapshot(); isolated.round.remaining.charge = 99; assert.notDeepEqual(reloaded.getSnapshot(), isolated);
  const world = createWorld(), report = [];
  for (let attempt = 0; attempt < MAX_MAIN_ROUNDS && world.getSnapshot().research < 120; attempt++) {
    const research = world.getSnapshot().research, loadout = fullLoadout(research);
    assert.ok(world.startRound('courtyard', loadout));
    while (WEAPONS.some(id => world.getRound().remaining[id])) {
      const snapshot = world.getSnapshot(), weapon = usefulWeapon({ round: world.getRound() }), power = attempt === 0 && world.getRound().used === 0 ? .25 : 1;
      const plan = (await rankShots(snapshot, weapon, power))[0];
      assert.ok(plan?.score > 0, 'Native progression has a useful physically reachable shot');
      assert.ok(world.recordShot(weapon)); world.damage({ id: `native-${attempt}-${world.getRound().used}`, epoch: world.epoch, target: plan.event.position, weapon, power });
      const detail = { attempt: attempt + 1, weapon, research: world.getSnapshot().research, budget: world.getRound().budget, used: world.getRound().used, fraction: world.getObjective().fraction };
      report.push(detail); console.log(`V05_NATIVE_SHOT ${JSON.stringify(detail)}`);
    }
    world.finishRound();
  }
  assert.ok(world.getSnapshot().research >= 120, 'A bounded legal loadout/input route reaches all unlocks');
  const thresholdRoutes = [];
  for (const map of ['courtyard', 'warehouse']) {
    assert.ok(world.loadMap(map, true)); let shots = 0;
    for (; shots < MAX_FREE_SHOTS && world.getObjective().fraction < .7; shots++) {
      const plan = (await rankShots(world.getSnapshot(), 'shock'))[0];
      assert.ok(plan?.score > 0); world.damage({ id: `free-${map}-${shots}`, epoch: world.epoch, target: plan.event.position, weapon: 'shock', power: 1, reward: false });
    }
    assert.ok(world.getObjective().fraction >= .7, `Free ${map} has a bounded real-input >70% route`);
    thresholdRoutes.push({ map, shots, fraction: world.getObjective().fraction });
  }
  console.log(JSON.stringify({ status: 'native-preflight-passed', report, thresholdRoutes }, null, 2));
}
if (process.env.PREFLIGHT_ONLY) { await nativePreflight(); process.exit(0); }

// This branch is run ONLY on authorized standard Ubuntu Chrome CI. All gameplay
// mutations use real visible controls/pointer/keyboard; evaluate() only reads.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const errors = [], evidence = { checks: [], shots: [], screenshots: [] }, output = 'artifacts/v05-browser';
const startedAt = Date.now();
const watchdog = setTimeout(() => { console.error('V05_TIMEOUT runtime exceeded 24 minutes'); void browser.close(); }, 24 * 60 * 1000);
page.on('pageerror', error => errors.push(String(error))); await fs.mkdir(output, { recursive: true });
const read = () => page.evaluate(() => {
  const h = window.__heping;
  return { snapshot: h.snapshot(), mainSnapshot: h.mainSnapshot(), objective: h.objective(), round: h.round(), projectiles: h.projectiles(), detonations: h.lastDetonations(),
    target: h.target, weapon: h.weapon, flow: h.flow, activeEffects: h.activeEffects, renderedProjectiles: h.renderedProjectiles,
    mode: h.mode, screen: h.screen, navigation: h.navigation, inventory: h.inventory, mainResearch: h.mainResearch, lastFinishEvidence: h.lastFinishEvidence,
    paused: document.querySelector('#pause').classList.contains('active'), slow: document.querySelector('#slow').classList.contains('active'),
    modal: document.querySelector('#completion-dialog').open, navigationModal: document.querySelector('#navigation-dialog').open };
});
const compact = s => ({ research: s.snapshot.research, mainResearch: s.mainResearch, destroyed: s.snapshot.destroyedCount, epoch: s.snapshot.epoch, objective: s.objective, round: s.round, inventory: s.inventory, projectiles: s.projectiles, detonations: s.detonations, weapon: s.weapon, flow: s.flow, activeEffects: s.activeEffects, renderedProjectiles: s.renderedProjectiles, mode: s.mode, screen: s.screen, navigation: s.navigation, paused: s.paused, modal: s.modal });
function record(name, detail = {}) { const check = { name, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), ...detail }; evidence.checks.push(check); console.log(`V05_PROGRESS ${JSON.stringify(check)}`); }
async function capture(name, emit = true) {
  const png = await page.screenshot({ path: `${output}/${name}.png` });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50, scale: 'css' });
  assert.ok(jpg.length <= 220000, `JPEG evidence exceeds 220KB: ${name} ${jpg.length}`);
  await fs.writeFile(`${output}/${name}.jpg`, jpg); evidence.screenshots.push({ name, bytes: jpg.length, quality: 50 });
  if (process.env.CI && emit) console.log(`SCREENSHOT_BASE64 v05-${name} ${jpg.toString('base64')}`);
  return png;
}
async function waitFor(test, arg, label, timeout = 60000) {
  try { await page.waitForFunction(test, arg, { timeout }); }
  catch (error) { throw new Error(`${label}: ${String(error)}; current=${JSON.stringify(compact(await read()))}`); }
}
async function waitScreen(screen) { await waitFor(screen => window.__heping.screen === screen, screen, `Navigate to ${screen}`); }
async function idle() { await waitFor(() => !window.__heping.activeEffects && window.__heping.projectiles().length === 0, null, 'Core effects and ordnance settle', 120000); }
async function waitEvent(id) { await waitFor(id => window.__heping.lastDetonations().some(e => e.id === id), id, `Detonation ${id}`); return (await read()).detonations.find(e => e.id === id); }
async function noAutoSummary(label) { const state = await read(); assert.equal(state.flow, 'active', label); assert.equal(state.paused, false, label); assert.equal(state.modal, false, label); assert.equal(state.screen, 'playing', label); return state; }
async function assertNoPreview() {
  assert.deepEqual(await page.locator('#delivery option').evaluateAll(nodes => nodes.map(n => n.value)), ['quick', 'place']);
  assert.equal(await page.locator('#cancel-preview').count(), 0);
  assert.equal(await page.getByRole('button', { name: /预览轨迹|确认发射|取消轨迹/ }).count(), 0);
}
async function checkReachability(ids, label) {
  const result = await page.evaluate(ids => ({ overflow: document.documentElement.scrollWidth > innerWidth,
    controls: ids.map(id => { const element = document.getElementById(id), r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id, reachable: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + .5 && r.top >= 0 && r.bottom <= innerHeight + .5 && (hit === element || element.contains(hit)) }; }) }), ids);
  assert.equal(result.overflow, false, `${label} horizontal overflow`); assert.ok(result.controls.every(c => c.reachable), `${label}: ${JSON.stringify(result)}`); return result;
}
async function canvasPixels() {
  const png = PNG.sync.read(await page.locator('canvas').screenshot()), colors = new Set(); let bright = 0;
  for (let y = Math.floor(png.height * .25); y < png.height * .75; y += 4) for (let x = Math.floor(png.width * .25); x < png.width * .75; x += 4) {
    const i = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(i, i + 3); colors.add(`${r >> 3},${g >> 3},${b >> 3}`); if (r + g + b > 100) bright++;
  }
  assert.ok(colors.size >= 100 && bright >= 500, `Canvas must really render a nonblank 3D scene: ${colors.size}/${bright}`); return { quantizedColors: colors.size, brightSamples: bright };
}
async function select(weapon, accepted = true) { const prior = (await read()).weapon; await page.locator(`[data-weapon="${weapon}"]`).click(); assert.equal((await read()).weapon, accepted ? weapon : prior); }
async function settings(delivery, trigger = 'automatic', power = 100) {
  await page.locator('#delivery').selectOption(delivery); if (delivery !== 'place') await page.locator('#trigger').selectOption(trigger);
  await page.locator('#power').focus(); await page.keyboard.press(power === 25 ? 'Home' : 'End'); assert.equal(await page.locator('#power').inputValue(), String(power));
}
async function clickPlan(plan) {
  const { x, y } = plan.screen;
  if (!await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('canvas'), { x, y })) return false;
  await page.mouse.click(x, y); const state = await read(); return state.target !== null && distance(state.target, plan.surface.position) < .12;
}
async function aimGround() {
  for (let z = 15; z >= -13; z -= 4) for (let x = -19; x <= 19; x += 4) {
    const target = { x, y: 0, z }, screen = project(target);
    if (screen.x < 330 || screen.x > WIDTH - 150 || screen.y < 200 || screen.y > HEIGHT - 175) continue;
    if (await clickPlan({ screen, surface: { position: target } })) return { target, screen };
  }
  throw new Error('No exposed ground selectable with real pointer');
}
async function aim(weapon, power = 1, allowHarmless = false) {
  const plans = await rankShots((await read()).snapshot, weapon, power);
  for (const plan of plans) if ((plan.score > 0 || allowHarmless) && await clickPlan(plan)) return plan;
  if (allowHarmless) return { surface: { position: (await aimGround()).target }, expectedBuilding: 0, expectedResearch: 0 };
  throw new Error(`No useful real-pointer aim: ${weapon}`);
}
async function aimRoof() {
  const snapshot = (await read()).snapshot, byId = new Map(snapshot.voxels.map(v => [v.id, v]));
  const plans = candidates(snapshot, true).filter(p => { const v = byId.get(p.surface.voxelId); return v.group === 'house' && v.material === 'roof' && Math.abs(v.position.x) < 4 && Math.abs(v.position.z) < 5; })
    .sort((a, b) => Math.hypot(a.screen.x - WIDTH / 2, a.screen.y - HEIGHT / 2) - Math.hypot(b.screen.x - WIDTH / 2, b.screen.y - HEIGHT / 2));
  for (const plan of plans) if (await clickPlan(plan)) return plan;
  throw new Error('No central roof surface visible for live-hole regression');
}
async function execute() {
  const before = await read(); await page.locator('#fire').click(); const after = await read();
  const body = after.projectiles.find(p => !before.projectiles.some(q => q.id === p.id)); assert.ok(body, 'Real input immediately creates physical ordnance, not a preview');
  assert.equal(after.snapshot.destroyedCount, before.snapshot.destroyedCount, 'Launch/placement never immediately damages');
  if (after.mode === 'main') {
    assert.equal(after.round.used, before.round.used + weaponCost(after.weapon));
    const ammoText = await page.locator('#ammo').innerText(); assert.ok(ammoText.includes(`${spent(after.round.remaining)} / ${spent(after.round.loadout)}`), 'Displayed ammo is actual carried stock, not unfilled capacity');
    for (const id of WEAPONS) assert.equal(after.round.remaining[id], before.round.remaining[id] - (id === after.weapon ? 1 : 0), 'Only selected tool inventory is spent');
  } else { assert.deepEqual(after.round, before.round); assert.match(await page.locator('#ammo').innerText(), /∞/); }
  return body;
}
async function verifyRoundLocks() {
  const state = await read();
  if (state.mode !== 'main') return;
  for (const [id, threshold] of [['pulse', 40], ['shock', 90]]) if (state.round.startResearch < threshold) {
    const prior = (await read()).weapon; await page.locator(`[data-weapon="${id}"]`).click(); assert.equal((await read()).weapon, prior, `Tool unlock ${threshold} cannot alter this round's loadout`);
  }
  assert.equal(state.round.budget, capacityForResearch(state.round.startResearch), 'Capacity frozen at round start');
}
async function shootBest(weapon, power = 100, allowHarmless = false) {
  await select(weapon); await settings(weapon === 'shock' ? 'place' : 'quick', 'automatic', power);
  const before = await read(), plan = await aim(weapon, power / 100, allowHarmless), body = await execute();
  if (weapon === 'shock') await page.locator('#detonate').click();
  const event = await waitEvent(body.id), after = await noAutoSummary('Real damage never automatically settles'); await verifyRoundLocks();
  const detail = { mode: after.mode, map: after.objective.mapId, weapon, research: after.mainResearch, startResearch: after.round.startResearch, budget: after.round.budget, used: after.round.used, remaining: after.round.remaining, fraction: after.objective.fraction, expectedBuilding: plan.expectedBuilding, actualBuilding: after.objective.destroyed - before.objective.destroyed, event };
  evidence.shots.push(detail); console.log(`V05_SHOT ${JSON.stringify(detail)}`); return after;
}
async function setLoadout(loadout) {
  const values = await page.locator('[id^="loadout-"]').evaluateAll(nodes => Object.fromEntries(nodes.filter(n => /^(loadout-charge|loadout-pulse|loadout-shock)$/.test(n.id)).map(n => [n.id.replace('loadout-', ''), Number(n.value ?? n.textContent)])));
  assert.ok(WEAPONS.every(id => Number.isSafeInteger(values[id])), `Read visible loadout counts: ${JSON.stringify(values)}`);
  for (const id of WEAPONS) for (let count = values[id]; count > loadout[id]; count--) await page.locator(`[data-adjust="${id}"][data-delta="-1"]`).click();
  for (const id of WEAPONS) for (let count = Math.min(values[id], loadout[id]); count < loadout[id]; count++) await page.locator(`[data-adjust="${id}"][data-delta="1"]`).click();
}
async function startMain(loadout = null, map = 'courtyard') {
  await waitScreen('setup'); if (loadout) await setLoadout(loadout); await page.locator(`[data-scene="${map}"]`).click();
  assert.equal(await page.locator('#start-experiment').isDisabled(), false); await page.locator('#start-experiment').click(); await waitScreen('playing');
  const state = await read(); assert.equal(state.mode, 'main'); assert.equal(state.objective.mapId, map); assert.equal(state.objective.destroyed, 0); assert.equal(state.round.used, 0);
  if (loadout) { assert.deepEqual(state.round.loadout, loadout); assert.deepEqual(state.round.remaining, loadout); }
  return state;
}
async function finishRound(expectArmed = null) {
  await page.locator('#finish-round').click(); const pending = await read(); assert.equal(pending.paused, false, 'Finish cannot freeze live effects');
  if (expectArmed) {
    const synchronous = pending.lastFinishEvidence;
    assert.ok(synchronous, 'App exposes a deep-copy diagnostic of the actual finish click');
    assert.equal(synchronous.flow, 'ending'); assert.equal(synchronous.activeEffects, true); assert.equal(synchronous.paused, false); assert.equal(synchronous.projectiles, 0);
    assert.equal(synchronous.detonations.filter(e => e.id === expectArmed).length, 1); assert.equal(synchronous.detonations.find(e => e.id === expectArmed).reason, 'remote');
    if (pending.flow === 'ending') assert.equal(pending.modal, false, 'No modal before core effects finish');
  }
  await waitFor(() => document.querySelector('#completion-dialog').open, null, 'Explicit results after core effects', 120000);
  const settled = await read(); assert.equal(settled.round.settled, true); assert.equal(settled.flow, 'settled'); assert.equal(settled.activeEffects, false); assert.equal(settled.projectiles.length, 0);
  assert.equal(Number.parseInt(await page.locator('#result-damage').innerText(), 10), Math.round(settled.objective.fraction * 100), 'Results destruction is live, not mockup text');
  assert.equal(Number.parseInt(await page.locator('#result-earned').innerText(), 10), settled.mainResearch - settled.round.startResearch, 'Results RP equals this real round');
  assert.equal(Number(await page.locator('#result-total').innerText()), settled.mainResearch, 'Results total equals permanent main RP');
  assert.ok((await page.locator('#round-summary').innerText()).includes(`${settled.round.used} / ${settled.round.budget}`), 'Results capacity is live');
  return { finishClick: pending.lastFinishEvidence, pending: compact(pending), settled: compact(settled) };
}
async function retryToSetup() {
  const prior = await read(); await page.locator('#retry-map').click(); await waitScreen('setup'); const setup = await read();
  assert.equal(setup.mainResearch, prior.mainResearch); assert.equal(setup.modal, false); return setup;
}
async function goHome() { await page.locator('#game-home').click(); if ((await read()).navigationModal) { await page.locator('#confirm-leave').click(); } await waitScreen('home'); }

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5191', { waitUntil: 'networkidle' });
  await waitFor(() => window.__heping?.physicsReady, null, 'Physics startup'); await waitScreen('home');
  assert.equal((await read()).mainResearch, 0, 'Clean browser context begins with zero research');
  evidence.desktopHome = await checkReachability(['mode-main', 'mode-free'], 'Desktop home'); await capture('01-home');
  await page.locator('#mode-main').click(); await waitScreen('setup');
  assert.equal(await page.locator('[data-scene="warehouse"]').isDisabled(), true);
  for (const id of ['pulse', 'shock']) assert.equal(await page.locator(`[data-adjust="${id}"][data-delta="1"]`).isDisabled(), true);
  assert.match(await page.locator('#setup-screen').innerText(), /40/); assert.match(await page.locator('#setup-screen').innerText(), /90/);
  await setLoadout(emptyLoadout()); assert.equal(await page.locator('#start-experiment').isDisabled(), true, 'Empty loadout cannot start');
  await setLoadout({ charge: 6, pulse: 0, shock: 0 }); assert.match(await page.locator('#capacity-value').innerText(), /6/);
  assert.equal(await page.locator('[data-adjust="charge"][data-delta="1"]').isDisabled(), true, 'Cannot add a seventh capacity slot');
  await capture('02-main-loadout-six');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300); await page.locator('#start-experiment').scrollIntoViewIfNeeded();
  evidence.earlyMobileSetup = await checkReachability(['start-experiment', 'setup-back'], 'Early mobile main setup'); await capture('02b-mobile-loadout-early');
  await page.setViewportSize({ width: WIDTH, height: HEIGHT }); await page.waitForTimeout(300);
  await page.locator('#setup-back').click(); await waitScreen('home');
  record('home-main-setup-validates-six-slots-and-locks');

  // Free is a separate world, not an alternate main-ammunition refill control.
  await page.locator('#mode-free').click(); await waitScreen('setup');
  for (const map of ['courtyard', 'warehouse']) assert.equal(await page.locator(`[data-scene="${map}"]`).isDisabled(), false);
  await page.locator('[data-scene="warehouse"]').click(); await capture('03-free-setup-all-scenes');
  await page.locator('#start-experiment').click(); await waitScreen('playing'); await assertNoPreview();
  const freeInitial = await read(); assert.equal(freeInitial.mode, 'free'); assert.equal(freeInitial.objective.mapId, 'warehouse'); assert.equal(freeInitial.mainResearch, 0);
  assert.match(await page.locator('#ammo').innerText(), /∞/); assert.match(await page.locator('#finish-round').innerText(), /自由/);
  await select('pulse', false); await select('shock', false); await select('charge'); await settings('place');
  await aimGround(); const ground = await execute(); assert.equal(ground.state, 'attached'); assert.equal(ground.hostVoxelId, null); assert.equal(ground.fuseRemaining, null);
  const placedIds = [ground.id];
  for (const plan of candidates((await read()).snapshot, true)) { if (placedIds.length === 10) break; if (await clickPlan(plan)) placedIds.push((await execute()).id); }
  assert.equal(placedIds.length, 10, 'Ten distinct physical placements cover the former eight-body limit');
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age > 3.2), ground.id, 'Placed ordnance survives an automatic fuse');
  const placed = await noAutoSummary('Free remains active with ten armed objects'); assert.equal(placed.projectiles.length, 10); assert.equal(placed.renderedProjectiles, 10);
  assert.ok(placed.projectiles.every(p => p.state === 'attached' && p.trigger === 'remote' && p.fuseRemaining === null));
  await capture('04-ten-real-free-placements', false); await page.locator('#detonate').click();
  await waitFor(ids => ids.every(id => window.__heping.lastDetonations().some(e => e.id === id && e.reason === 'remote')), placedIds, 'Ten remote placements detonate');
  const freeDamaged = await read(); assert.ok(freeDamaged.snapshot.destroyedCount > 0); assert.equal(freeDamaged.mainResearch, 0); assert.equal(freeDamaged.snapshot.research, 0);
  assert.deepEqual(freeDamaged.mainSnapshot, freeInitial.mainSnapshot, 'Free damage cannot alter the saved main world or inventory');
  await idle(); await goHome(); record('free-all-scenes-locked-tools-unlimited-no-research', { placed: 10, rendered: 10, detonated: 10 });

  await page.locator('#mode-main').click(); const initial = await startMain({ charge: 6, pulse: 0, shock: 0 });
  evidence.canvas = await canvasPixels(); evidence.desktopGame = await checkReachability(['game-home', 'change-scene', 'finish-round', 'pause', 'camera', 'settings', 'fire', 'delivery', 'trigger'], 'Desktop game');
  await select('charge'); await settings('quick', 'automatic', 25); await aim('charge', .25); await page.locator('#slow').click();
  const beforeFlight = await read(), first = await execute();
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age >= .05), first.id, 'Live early flight');
  await page.locator('#pause').click(); const frozen = await read(), body = frozen.projectiles.find(p => p.id === first.id); assert.ok(body, 'Slow/pause captures an actual launched body');
  const native = await createProjectilePhysics();
  try {
    native.syncVoxels(beforeFlight.snapshot.voxels, beforeFlight.snapshot.epoch);
    assert.ok(native.launch({ id: body.id, epoch: beforeFlight.snapshot.epoch, origin: origin(beforeFlight.target), target: beforeFlight.target, weapon: 'charge', power: .25, trigger: 'automatic' }));
    for (let step = 0; step < Math.round(body.age * 120); step++) native.step(1 / 120);
    const predicted = native.getProjectiles()[0]; assert.ok(predicted); assert.ok(distance(body.position, predicted.position) < .025, 'Live trajectory equals independently simulated Rapier physics');
    evidence.trajectory = { actual: body.position, predicted: predicted.position, age: body.age, error: distance(body.position, predicted.position) };
  } finally { native.dispose(); }
  assert.ok(body.rotation && Math.abs(body.rotation.w - 1) > .00001, 'Grenade visibly rotates'); assert.ok(body.fuseRemaining > 0 && body.fuseRemaining < 3);
  await page.waitForTimeout(500); const still = await read(); assert.deepEqual(still.projectiles, frozen.projectiles, 'Pause freezes position, rotation, fuse and age'); assert.deepEqual(still.detonations, frozen.detonations);
  await page.locator('#slow').click(); await page.locator('#pause').click(); assert.equal((await waitEvent(first.id)).reason, 'timer');
  const partial = await noAutoSummary('Partial damage earns research without a threshold'); assert.ok(partial.mainResearch > 0 && partial.objective.fraction < .7); assert.equal(partial.round.used, 1);
  await idle(); await page.locator('#game-home').click(); assert.equal((await read()).navigationModal, true); await page.locator('#cancel-leave').click();
  const cancelledLeave = await read(); assert.equal(cancelledLeave.screen, 'playing'); assert.deepEqual(cancelledLeave.round, partial.round); assert.deepEqual(cancelledLeave.snapshot.voxels, partial.snapshot.voxels);
  await page.locator('#change-scene').click(); assert.equal((await read()).navigationModal, true); await page.locator('#cancel-leave').click();
  await page.reload({ waitUntil: 'networkidle' }); await waitFor(() => window.__heping?.physicsReady, null, 'Reload physics');
  if ((await read()).screen === 'home') await page.locator('#mode-main').click(); await waitScreen('playing'); const reloaded = await read();
  assert.deepEqual(reloaded.round, partial.round); assert.equal(reloaded.mainResearch, partial.mainResearch); assert.deepEqual(reloaded.snapshot.voxels, partial.snapshot.voxels);
  record('real-flight-partial-research-navigation-cancel-and-reload', { research: partial.mainResearch, fraction: partial.objective.fraction, used: reloaded.round.used, trajectoryError: evidence.trajectory.error });

  // Finish the first six-item round with the last grenade still remotely armed.
  while ((await read()).round.remaining.charge > 1) await shootBest('charge', 100, true);
  await select('charge'); await settings('place'); await aim('charge', 1, true); const emptyArmed = await execute();
  const exhausted = await noAutoSummary('Empty ammunition is not the end of an experiment'); assert.equal(exhausted.round.used, 6); assert.equal(exhausted.round.remaining.charge, 0);
  assert.equal(await page.locator('#fire').isDisabled(), true); assert.equal(await page.locator('#detonate').isDisabled(), false); assert.equal(await page.locator('#pause').isDisabled(), false);
  await page.keyboard.press('Space'); assert.equal((await read()).projectiles.length, exhausted.projectiles.length, 'Space cannot overspend empty inventory');
  await page.locator('#pause').click(); assert.equal((await read()).paused, true); await page.locator('#pause').click();
  await page.locator('#camera').click();
  await page.locator('#game-home').click(); assert.equal((await read()).navigationModal, true); await page.locator('#cancel-leave').click();
  assert.ok((await read()).projectiles.some(p => p.id === emptyArmed.id), 'Canceling departure cannot erase an armed last item');
  await capture('05-empty-ammo-still-armed');
  await page.locator('#detonate').click(); assert.equal((await waitEvent(emptyArmed.id)).reason, 'remote'); await noAutoSummary('Manual detonation remains possible after ammunition is empty');
  evidence.firstRound = await finishRound(); await capture('06-explicit-results'); await retryToSetup();
  record('six-grenade-empty-ammo-remains-observable-and-manually-detonatable');

  let mixedChecked = false, crossed120 = false;
  for (let attempt = 1; attempt < MAX_MAIN_ROUNDS && (await read()).mainResearch < 120; attempt++) {
    const research = (await read()).mainResearch, loadout = fullLoadout(research); await startMain(loadout);
    const start = await read();
    while (usefulWeapon(await read())) {
      const before = await read(), id = usefulWeapon(before), after = await shootBest(id, 100, true);
      if (before.mainResearch < 120 && after.mainResearch >= 120) { crossed120 = true; assert.equal(after.round.budget, 6); assert.equal(after.round.startResearch, start.round.startResearch); }
      if (!mixedChecked && loadout.shock && id === 'shock') {
        assert.equal(after.round.remaining.shock, 0); assert.ok(after.round.remaining.charge > 0 && after.round.remaining.pulse > 0);
        assert.equal(await page.locator('#fire').isDisabled(), true, 'An exhausted selected tool cannot borrow another type');
        const count = after.projectiles.length, used = after.round.used; await page.keyboard.press('Space'); const blocked = await read(); assert.equal(blocked.projectiles.length, count); assert.equal(blocked.round.used, used);
        mixedChecked = true; record('mixed-one-two-two-capacity-and-per-type-exhaustion', { loadout, cost: spent(loadout), budget: after.round.budget, remaining: after.round.remaining });
      }
    }
    await noAutoSummary('A spent inventory never automatically settles'); evidence.rounds ??= []; evidence.rounds.push(await finishRound()); await retryToSetup();
    record('legal-loadout-round-ended-and-retry-returns-setup', { attempt: attempt + 1, research: (await read()).mainResearch, loadout });
  }
  const unlockedResearch = (await read()).mainResearch; assert.ok(unlockedResearch >= 120, 'Real legal loadouts reach 40/90/120'); assert.equal(crossed120, true, 'A live six-slot round really crosses the 120 upgrade boundary');
  assert.equal(await page.locator('[data-scene="warehouse"]').isDisabled(), false);
  // A deliberately partly-filled eight-slot loadout also proves capacity is a
  // ceiling, not a requirement to fill every slot or spend permanent research.
  const mixed = { charge: 2, pulse: 1, shock: 1 }; await startMain(mixed, 'warehouse');
  const eight = await read(); assert.equal(eight.round.budget, 8); assert.equal(eight.mainResearch, unlockedResearch); assert.equal(spent(eight.round.loadout), 6);
  await select('pulse'); await shootBest('pulse'); const pulseEmpty = await read(); assert.equal(pulseEmpty.round.remaining.pulse, 0); assert.ok(pulseEmpty.round.remaining.charge > 0 && pulseEmpty.round.remaining.shock > 0);
  assert.equal(await page.locator('#fire').isDisabled(), true); mixedChecked = true;
  await select('shock'); await settings('place'); await aim('shock'); const finishArmed = await execute();
  evidence.coreWait = await finishRound(finishArmed.id); await capture('07-eight-slot-explicit-core-wait-results', false);
  const summary = await read(); await page.locator('#observe-scene').click(); const observed = await read(); assert.equal(observed.modal, false); assert.deepEqual(observed.snapshot.voxels, summary.snapshot.voxels); assert.equal(observed.round.settled, true);
  await page.locator('#finish-round').click(); await retryToSetup();
  const priorResearch = (await read()).mainResearch; const rebuilt = await startMain({ charge: 0, pulse: 0, shock: 4 }, 'courtyard');
  assert.equal(rebuilt.round.budget, 8); assert.equal(rebuilt.mainResearch, priorResearch); assert.equal(rebuilt.objective.destroyed, 0); assert.equal(rebuilt.snapshot.voxels.length, initial.snapshot.voxels.length);
  // New mode capacity may make 70% unreachable in a legal main loadout. Verify
  // no automatic result at its actual reachable damage, never overspend/buff.
  for (let shot = 0; shot < 4; shot++) await shootBest('shock');
  const mainCeiling = await noAutoSummary('Main finite-loadout damage has no automatic result'); evidence.mainFiniteDamage = compact(mainCeiling);
  assert.equal(mainCeiling.round.used, 8); await finishRound(); await page.locator('#result-home').click(); await waitScreen('home');
  record('120-upgrade-frozen-until-next-round-and-full-building-retry', { mixedChecked, crossed120, budget: 8, mainReachableFraction: mainCeiling.objective.fraction });

  // Freely observe real rockets/live colliders and remote-launched grenades.
  await page.locator('#mode-free').click(); await waitScreen('setup'); await page.locator('[data-scene="courtyard"]').click(); await page.locator('#start-experiment').click(); await waitScreen('playing');
  const mainSaved = (await read()).mainSnapshot; await select('pulse'); await settings('quick'); const roof = await aimRoof();
  const rocketEvents = [];
  for (let pass = 0; pass < 2; pass++) {
    await page.locator('#slow').click(); const rocket = await execute(); await page.locator('#pause').click();
    const paused = await read(), body = paused.projectiles.find(p => p.id === rocket.id); assert.ok(body); assert.ok(Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) > 0);
    const screen = project(body.position); assert.ok(screen.z > -1 && screen.z < 1 && screen.x > 0 && screen.x < WIDTH && screen.y > 0 && screen.y < HEIGHT);
    await page.locator('#slow').click(); await page.locator('#pause').click(); const event = await waitEvent(rocket.id); assert.equal(event.reason, 'impact'); rocketEvents.push(event);
  }
  assert.ok(rocketEvents[1].position.y < rocketEvents[0].position.y - .5, 'Second actual rocket passes through newly removed roof collider'); evidence.roofHole = { aim: roof.surface.position, events: rocketEvents };
  await idle(); await page.locator('#reset').click();
  await select('charge'); await settings('quick', 'remote'); await aim('charge'); const remote = await execute();
  await waitFor(id => window.__heping.projectiles().some(p => p.id === id && p.age >= 12.5), remote.id, 'Remote launched grenade survives normal fuse and cleanup');
  const armed = (await read()).projectiles.find(p => p.id === remote.id); assert.equal(armed.fuseRemaining, null); assert.equal(armed.trigger, 'remote'); assert.equal(armed.state, 'flying');
  await page.locator('#detonate').click(); assert.equal((await waitEvent(remote.id)).reason, 'remote'); await idle(); await page.locator('#reset').click();
  await select('shock'); await settings('place'); const packageIds = [];
  for (const plan of candidates((await read()).snapshot, true)) { if (packageIds.length === 9) break; if (await clickPlan(plan)) packageIds.push((await execute()).id); }
  assert.equal(packageIds.length, 9); assert.equal((await read()).renderedProjectiles, 9); await page.locator('#detonate').click();
  await waitFor(ids => ids.every(id => window.__heping.lastDetonations().some(e => e.id === id)), packageIds, 'Nine packages detonate');
  for (let shot = 0; shot < MAX_FREE_SHOTS && (await read()).objective.fraction < .7; shot++) await shootBest('shock');
  const seventy = await noAutoSummary('Free 70% never triggers automatic results'); assert.ok(seventy.objective.fraction >= .7); await page.waitForTimeout(1000); await noAutoSummary('Free remains playable above 70%');
  const freeFinal = await read(); assert.deepEqual(freeFinal.mainSnapshot, mainSaved); assert.equal(freeFinal.mainResearch, mainSaved.research); evidence.freeSeventy = compact(freeFinal);
  record('physical-regressions-live-roof-remote-fuse-nine-packages-and-free-seventy', { freeFraction: seventy.objective.fraction, mainResearch: freeFinal.mainResearch });

  await idle();
  const beforeDrag = await read(); await page.mouse.move(650, 380); await page.mouse.down(); await page.mouse.move(720, 420, { steps: 10 }); await page.mouse.up();
  const afterDrag = await read(); assert.deepEqual(afterDrag.target, beforeDrag.target, 'Dragging orbits without changing aim'); assert.deepEqual(afterDrag.round, beforeDrag.round); assert.equal(afterDrag.snapshot.destroyedCount, beforeDrag.snapshot.destroyedCount);
  await page.locator('#camera').click();
  await settings('place'); await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
  evidence.mobileGame = await checkReachability(['game-home', 'change-scene', 'pause', 'camera', 'reset', 'settings', 'fire', 'detonate', 'delivery', 'trigger'], 'Mobile landscape gameplay'); await capture('08-mobile-landscape-game');
  await page.locator('#settings').click(); await page.locator('#settings-dialog .done').click(); await goHome();
  evidence.mobileHome = await checkReachability(['mode-main', 'mode-free'], 'Mobile home'); await page.locator('#mode-main').click(); await waitScreen('setup');
  // Scrolling a setup panel is a normal mobile interaction; scrolling the whole
  // layout horizontally, or permanently hidden start/back controls, is not.
  await page.locator('#start-experiment').scrollIntoViewIfNeeded(); evidence.mobileSetup = await checkReachability(['start-experiment', 'setup-back'], 'Mobile setup'); await capture('09-mobile-main-setup');
  assert.deepEqual(errors, []); evidence.final = compact(await read()); evidence.status = 'passed'; record('all-v05-real-input-checks-passed', { durationSeconds: Math.round((Date.now() - startedAt) / 1000) });
} catch (error) {
  evidence.status = 'failed'; evidence.failure = String(error); evidence.current = await read().then(compact).catch(() => null);
  await capture('failure').catch(captureError => { evidence.captureFailure = String(captureError); }); throw error;
} finally {
  clearTimeout(watchdog); evidence.errors = errors; evidence.durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  await fs.writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2)); await browser.close();
}
