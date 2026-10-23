import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { tsImport } from 'tsx/esm/api';
import { createSchema5Fixture, createOverLimitSchema6Fixture } from './v07-qa-fixtures.mjs';
import { WEAPON_IDS, MAP_IDS, DESKTOP, MOBILE_LANDSCAPE, MOBILE_PORTRAIT, OPERATION_CONTROLS,
  overlaps, assertInsideViewport, assertVerticalStack, assertStationary, assertSideComposition } from './v07-qa-contract.mjs';

// Run ONLY in the already authorized GitHub standard Chrome job. Never use this
// as a retry of denied authoring-sandbox Chromium or on the user's computer.
// Every gameplay action uses visible controls / pointer input. All evaluate()
// callbacks are read-only. The only storage write is a named synthetic legacy
// fixture installed BEFORE page load; no organic-progression claim is made.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'v0.7 browser QA is restricted to the authorized GitHub Actions runner');
assert.equal(process.env.QA_BROWSER_CHANNEL, 'chrome', 'Use the authorized standard Chrome channel');
assert.equal(process.env.CHROMIUM_PATH, undefined, 'Executable overrides are not permitted');
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);
const output = 'artifacts/v07-browser', started = Date.now();
const evidence = { checks: [], screenshots: [], fixtures: [], geometry: [], errors: [], consoleErrors: [], httpErrors: [] };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const watchdog = setTimeout(() => { console.error('V07_TIMEOUT: 9-minute bound reached'); void browser.close(); }, 540000);
let context, page;
const gameUrl = process.env.GAME_URL || 'http://127.0.0.1:5191';

function record(name, detail = {}) {
  const check = { name, seconds: Math.round((Date.now() - started) / 1000), ...detail };
  evidence.checks.push(check); console.log('V07_PROGRESS ' + JSON.stringify(check));
}
async function openContext(fixture, fixtureName) {
  if (context) await context.close();
  context = await browser.newContext({ viewport: DESKTOP });
  if (fixture) {
    evidence.fixtures.push({ name: fixtureName, schemaVersion: fixture.schemaVersion, research: fixture.research,
      destroyedCount: fixture.destroyedCount, round: fixture.round, warning: 'Synthetic fixture before page load, not organic progression' });
    await context.addInitScript(({ save, name }) => {
      const marker = 'v07-fixture:' + name;
      if (!sessionStorage.getItem(marker)) {
        localStorage.setItem('hepingmoniqi.first-playable.v1', JSON.stringify(save));
        sessionStorage.setItem(marker, 'seeded-before-load');
      }
    }, { save: fixture, name: fixtureName });
  }
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) evidence.httpErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(gameUrl, { waitUntil: 'networkidle' }); await ready(); await screen('home');
}
const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
const ready = () => wait(() => window.__heping?.physicsReady);
const screen = expected => wait(expected => window.__heping.screen === expected, expected);
const read = () => page.evaluate(() => {
  const h = window.__heping;
  return { snapshot: h.snapshot(), mainSnapshot: h.mainSnapshot(), round: h.round(), projectiles: h.projectiles(),
    events: h.lastDetonations(), screen: h.screen, mode: h.mode, weapon: h.weapon, target: h.target,
    flow: h.flow, activeEffects: h.activeEffects, rendered: h.renderedProjectiles, pending: h.pendingWork?.(),
    setupLoadout: h.setupLoadout, previewMap: h.previewMap, modal: document.querySelector('#completion-dialog').open };
});
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50, scale: 'css' });
  assert.ok(jpg.length <= 220000, `${name}: screenshot exceeds 220 KB`);
  await fs.writeFile(`${output}/${name}.jpg`, jpg); evidence.screenshots.push({ name, bytes: jpg.length, quality: 50 });
  console.log(`SCREENSHOT_BASE64 v07-${name} ${jpg.toString('base64')}`);
}
const box = selector => page.locator(selector).evaluate(el => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});
async function inspect(selectors = []) {
  return page.evaluate(selectors => {
    const describe = el => {
      const r = el.getBoundingClientRect(), css = getComputedStyle(el), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
        visible: r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none',
        reachable: r.width > 0 && r.height > 0 && r.left >= -.5 && r.right <= innerWidth + .5 && r.top >= -.5 && r.bottom <= innerHeight + .5 && (hit === el || el.contains(hit)),
        hit: hit?.id || hit?.className || hit?.tagName || null, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft,
        clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: css.overflowY,
        clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, overflowX: css.overflowX };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      documentScroll: { x: window.scrollX, y: window.scrollY },
      controls: Object.fromEntries(selectors.map(selector => { const el = document.querySelector(selector); return [selector, el ? describe(el) : null]; })),
      scenes: [...document.querySelectorAll('[data-scene]')].map(describe),
      loadout: [...document.querySelectorAll('[data-loadout]')].map(describe),
      rail: document.querySelector('#tool-rail') ? describe(document.querySelector('#tool-rail')) : null,
      operations: document.querySelector('#operation-panel') ? describe(document.querySelector('#operation-panel')) : null };
  }, selectors);
}
async function reachable(selector, minimum = 44, { scroll = false } = {}) {
  if (scroll) await page.locator(selector).scrollIntoViewIfNeeded();
  const sample = await inspect([selector]), item = sample.controls[selector];
  assert.equal(sample.horizontalOverflow, false, `${selector}: horizontal page overflow`);
  assert.ok(item?.reachable, `${selector}: not reachable: ${JSON.stringify(item)}`);
  if (minimum) assert.ok(item.rect.width >= minimum - .1 && item.rect.height >= minimum - .1,
    `${selector}: touch target smaller than ${minimum}px: ${JSON.stringify(item.rect)}`);
  return item;
}
async function resize(size, label) {
  await page.setViewportSize(size);
  const immediate = await inspect();
  assert.equal(immediate.horizontalOverflow, false, `${label}: horizontal overflow immediately after resize`);
  await page.waitForTimeout(180);
  const settled = await inspect(); assert.equal(settled.horizontalOverflow, false, `${label}: horizontal overflow after layout settles`);
  evidence.geometry.push({ label, immediate, settled });
}
async function centerCanvas(label, left, right) {
  const viewport = page.viewportSize();
  const samples = await page.evaluate(({ left, right }) => {
    const canvas = document.querySelector('canvas'), points = [];
    const x1 = left ?? innerWidth * .38, x2 = right ?? innerWidth * .62;
    for (const fx of [.25, .5, .75]) for (const fy of [.32, .43, .54]) {
      const x = x1 + (x2 - x1) * fx, y = innerHeight * fy;
      const hit = document.elementFromPoint(x, y);
      points.push({ x, y, canvas: hit === canvas, hit: hit?.id || hit?.tagName || null });
    }
    return points;
  }, { left, right });
  assert.ok(samples.filter(p => p.canvas).length >= 3, `${label}: center live canvas intercepted ${JSON.stringify(samples)}`);
  evidence.geometry.push({ label: `${label}-canvas-center`, viewport, samples });
}
async function pixels() {
  const png = PNG.sync.read(await page.locator('canvas').screenshot()), colors = new Set(); let bright = 0;
  for (let y = png.height * .25 | 0; y < png.height * .75; y += 4) for (let x = png.width * .25 | 0; x < png.width * .75; x += 4) {
    const i = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(i, i + 3); colors.add(`${r >> 3},${g >> 3},${b >> 3}`); if (r + g + b > 100) bright++;
  }
  assert.ok(colors.size >= 100 && bright >= 500, 'live WebGL canvas is blank or near-uniform'); return { colors: colors.size, bright };
}
async function wheelList(selector, lastSelector) {
  const attempt = { label: `internal-scroll-${selector}`, selector, phase: 'reset-to-top' };
  try {
    const initial = await inspect([selector, '#start-experiment', '#capacity-section']);
    attempt.initial = initial;
    const initialRect = initial.controls[selector].rect;
    const pointer = { x: (initialRect.left + initialRect.right) / 2, y: (initialRect.top + initialRect.bottom) / 2 };
    attempt.pointer = pointer;
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.wheel(0, -10000);
    // mouse.wheel() resolves on event dispatch, not after Chrome's compositor
    // applies scrolling. Wait for observed scroll state, never a 160 ms guess.
    await page.waitForFunction(selector => document.querySelector(selector).scrollTop <= 1, selector, { timeout: 15000 });
    const before = await inspect([selector, '#start-experiment', '#capacity-section']);
    attempt.before = before;
    const scroller = before.controls[selector];
    assert.ok(['auto', 'scroll'].includes(scroller.overflowY), `${selector}: must own vertical overflow`);
    assert.ok(scroller.reachable, `${selector}: wheel midpoint is outside its clipped viewport: ${JSON.stringify(scroller)}`);
    attempt.phase = 'scroll-to-bottom';
    await page.mouse.move((scroller.rect.left + scroller.rect.right) / 2, (scroller.rect.top + scroller.rect.bottom) / 2);
    await page.mouse.wheel(0, 10000);
    if (scroller.scrollHeight > scroller.clientHeight + 2) {
      await page.waitForFunction(selector => {
        const el = document.querySelector(selector);
        return el.scrollTop > 0 && el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
      }, selector, { timeout: 15000 });
    }
    const after = await inspect([selector, '#start-experiment', '#capacity-section']);
    attempt.after = after; attempt.phase = 'assert-pinned-footer-and-last-item';
    if (scroller.scrollHeight > scroller.clientHeight + 2) assert.ok(after.controls[selector].scrollTop > scroller.scrollTop, `${selector}: wheel did not scroll its own list`);
    assertStationary(before.controls['#start-experiment'].rect, after.controls['#start-experiment'].rect, `${selector}: pinned start`);
    assertStationary(before.controls['#capacity-section'].rect, after.controls['#capacity-section'].rect, `${selector}: pinned capacity`);
    assert.deepEqual(after.documentScroll, before.documentScroll, `${selector}: panel wheel moved the page`);
    await reachable(lastSelector, 0); await reachable('#start-experiment');
    attempt.phase = 'passed';
  } catch (error) {
    attempt.failure = String(error);
    attempt.afterFailure = await inspect([selector, '#start-experiment', '#capacity-section']).catch(() => null);
    console.log('V07_SCROLL_FAILURE ' + JSON.stringify(attempt));
    throw error;
  } finally {
    evidence.geometry.push(attempt);
  }
}
async function setupGeometry(label, desktop = true) {
  const sample = await inspect(['.scene-panel', '.loadout-panel', '.scene-choices', '.loadout-rows', '#start-experiment', '#capacity-section']);
  assert.equal(sample.horizontalOverflow, false);
  assert.equal(sample.scenes.length, MAP_IDS.length); assert.equal(sample.loadout.length, WEAPON_IDS.length);
  if (desktop) {
    assertSideComposition({ viewport: sample.viewport, left: sample.controls['.scene-panel'].rect, right: sample.controls['.loadout-panel'].rect,
      scenes: sample.scenes.map(s => s.rect), loadout: sample.loadout.map(s => s.rect) });
    await centerCanvas(label, sample.controls['.scene-panel'].rect.right, sample.controls['.loadout-panel'].rect.left);
  }
  await reachable('#start-experiment'); await reachable('#capacity-help');
  await wheelList('.scene-choices', '[data-scene="cantilever"]');
  await wheelList('.loadout-rows', '[data-loadout="phase"]');
  record(label, { canvas: await pixels(), panelRects: { scenes: sample.controls['.scene-panel'].rect, loadout: sample.controls['.loadout-panel'].rect } });
}
async function setRail(open) {
  const toggle = page.locator('#tool-rail-toggle');
  assert.equal(await toggle.getAttribute('aria-controls'), 'tool-rail-content');
  if ((await toggle.getAttribute('aria-expanded') === 'true') !== open) { await reachable('#tool-rail-toggle'); await toggle.click(); }
  assert.equal(await toggle.getAttribute('aria-expanded'), String(open));
  await page.waitForTimeout(180);
}
async function expectRail(types) {
  await setRail(true);
  const actual = await page.locator('#tool-rail-content [data-weapon]').evaluateAll(elements => elements.filter(el => getComputedStyle(el).display !== 'none').map(el => el.dataset.weapon));
  assert.deepEqual(actual, WEAPON_IDS.filter(id => types.includes(id)), 'rail contains exactly the carried types, including depleted ones');
  assert.ok(actual.length <= 3, 'round may carry at most three tool types');
}
async function select(id) { await setRail(true); await page.locator(`[data-weapon="${id}"]`).scrollIntoViewIfNeeded(); await page.locator(`[data-weapon="${id}"]`).click(); assert.equal((await read()).weapon, id); }
async function aim() {
  const viewport = page.viewportSize(), camera = new THREE.PerspectiveCamera(42, viewport.width / viewport.height, .2, 250);
  camera.position.set(27, 23, 32); camera.lookAt(0, 4.5, 0); camera.updateMatrixWorld();
  const s = await read();
  for (const v of s.snapshot.voxels.filter(v => v.group === 'house').sort((a, b) => b.position.y - a.position.y)) {
    const projected = new THREE.Vector3(v.position.x, v.position.y, v.position.z).project(camera);
    const x = (projected.x + 1) * viewport.width / 2, y = (1 - projected.y) * viewport.height / 2;
    if (x < 15 || x > viewport.width - 15 || y < 100 || y > viewport.height - 30) continue;
    if (!await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('canvas'), { x, y })) continue;
    await page.mouse.click(x, y); if ((await read()).target) return { x, y };
  }
  throw new Error('No exposed building voxel accepts actual pointer aiming');
}
async function fire(cost = 3) {
  const before = await read(); await reachable('#fire'); await page.locator('#fire').click(); const after = await read();
  const body = after.projectiles.find(v => !before.projectiles.some(p => p.id === v.id)); assert.ok(body, 'visible fire button must create a physical body');
  if (after.mode === 'main') {
    assert.equal(after.round.used, before.round.used + cost);
    for (const id of WEAPON_IDS) assert.equal(after.round.remaining[id], before.round.remaining[id] - (id === after.weapon ? 1 : 0));
  }
  return body;
}
async function home() {
  if (await page.locator('#completion-dialog').evaluate(el => el.open)) { await page.locator('#result-home').click(); await screen('home'); return; }
  await page.locator('#game-home').click(); if (await page.locator('#navigation-dialog').evaluate(el => el.open)) await page.locator('#confirm-leave').click(); await screen('home');
}
async function setLoadout(desired) {
  for (const id of WEAPON_IDS) while (Number(await page.locator('#loadout-' + id).innerText()) > (desired[id] ?? 0)) {
    await page.locator(`[data-adjust="${id}"][data-delta="-1"]`).scrollIntoViewIfNeeded(); await page.locator(`[data-adjust="${id}"][data-delta="-1"]`).click();
  }
  for (const id of WEAPON_IDS) while (Number(await page.locator('#loadout-' + id).innerText()) < (desired[id] ?? 0)) {
    await page.locator(`[data-adjust="${id}"][data-delta="1"]`).scrollIntoViewIfNeeded(); await page.locator(`[data-adjust="${id}"][data-delta="1"]`).click();
  }
}
async function gameplayGeometry(label, { portrait = false } = {}) {
  await setRail(true);
  await reachable('#tool-rail-toggle');
  const railTypes = await page.locator('#tool-rail-content [data-weapon]').evaluateAll(elements => elements.filter(el => getComputedStyle(el).display !== 'none').map(el => el.dataset.weapon));
  for (const id of railTypes) await reachable(`[data-weapon="${id}"]`, 44, { scroll: true });
  const expanded = await inspect(['#tool-rail', '#tool-rail-toggle', '#tool-rail-content', '#operation-panel']);
  assertInsideViewport(expanded.controls['#tool-rail-toggle'].rect, expanded.viewport, 'tool rail toggle');
  assertInsideViewport(expanded.controls['#operation-panel'].rect, expanded.viewport, 'operation panel');
  assert.equal(overlaps(expanded.rail.rect, expanded.operations.rect), false, `${label}: open rail covers operation panel`);
  for (const selector of OPERATION_CONTROLS) await reachable(selector);
  const before = await read(), operationBefore = expanded.operations.rect;
  const vacated = expanded.controls['#tool-rail-content'].rect;
  await setRail(false);
  assert.equal(await page.locator('#tool-rail-content').isVisible(), false, 'collapsed rail body must not be visible');
  const closed = await inspect(['#tool-rail', '#operation-panel']);
  assertStationary(operationBefore, closed.operations.rect, `${label}: operation panel independent of rail`);
  const after = await read(); assert.equal(after.weapon, before.weapon); assert.equal(after.snapshot.epoch, before.snapshot.epoch); assert.deepEqual(after.round, before.round);
  const vacatedCanvas = await page.evaluate(r => {
    const canvas = document.querySelector('canvas'), points = [];
    for (const fy of [.3, .55, .8]) { const x = (r.left + r.right) / 2, y = r.top + r.height * fy; if (x > 0 && x < innerWidth && y > 0 && y < innerHeight) points.push(document.elementFromPoint(x, y) === canvas); }
    return points;
  }, vacated);
  assert.ok(vacatedCanvas.some(Boolean), `${label}: hidden rail still intercepts the vacated canvas`);
  for (const selector of OPERATION_CONTROLS) await reachable(selector);
  await centerCanvas(label); await capture(label + '-collapsed');
  await setRail(true);
  assert.equal((await read()).weapon, before.weapon);
  await capture(label + '-expanded');
  evidence.geometry.push({ label, expanded, closed, vacatedCanvas, portrait });
  record(label, { carriedTypes: railTypes, rail: expanded.rail.rect, operations: expanded.operations.rect });
}
async function setFreeTools(types) {
  for (const id of WEAPON_IDS) {
    const button = page.locator(`[data-free-tool="${id}"]`);
    if (await button.getAttribute('aria-pressed') === 'true' && !types.includes(id)) { await button.scrollIntoViewIfNeeded(); await button.click(); }
  }
  for (const id of types) {
    const button = page.locator(`[data-free-tool="${id}"]`);
    if (await button.getAttribute('aria-pressed') !== 'true') { await button.scrollIntoViewIfNeeded(); await button.click(); }
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
  }
  const selected = await page.locator('[data-free-tool][aria-pressed="true"]').evaluateAll(elements => elements.map(el => el.dataset.freeTool));
  assert.deepEqual(selected, WEAPON_IDS.filter(id => types.includes(id)));
}
async function rejectFourthType(mode) {
  if (mode === 'main') {
    await setLoadout({ charge: 1, pulse: 1, shock: 1, echo: 0, split: 0 });
    const fourth = page.locator('[data-adjust="echo"][data-delta="1"]'); await fourth.scrollIntoViewIfNeeded();
    assert.equal(await fourth.isDisabled(), true, 'a fourth type must be blocked with spare capacity remaining');
    assert.equal((await read()).setupLoadout.echo, 0);
    await page.locator('[data-adjust="shock"][data-delta="-1"]').scrollIntoViewIfNeeded(); await page.locator('[data-adjust="shock"][data-delta="-1"]').click();
    assert.equal((await read()).setupLoadout.shock, 0);
    await fourth.scrollIntoViewIfNeeded(); assert.equal(await fourth.isDisabled(), false); await fourth.click();
    assert.deepEqual((await read()).setupLoadout, { charge: 1, pulse: 1, shock: 0, echo: 1, split: 0, phase: 0 });
  } else {
    await setFreeTools(['charge', 'pulse', 'shock']);
    const fourth = page.locator('[data-free-tool="echo"]'); await fourth.scrollIntoViewIfNeeded();
    assert.equal(await fourth.isDisabled(), true, 'free mode blocks a fourth type');
    await page.locator('[data-free-tool="shock"]').scrollIntoViewIfNeeded(); await page.locator('[data-free-tool="shock"]').click();
    await fourth.scrollIntoViewIfNeeded(); assert.equal(await fourth.isDisabled(), false); await fourth.click();
    assert.equal(await fourth.getAttribute('aria-pressed'), 'true');
  }
  record(`${mode}-at-most-three-types-fourth-rejected-zero-releases-slot`);
}
async function liveToggle(label) {
  await select('charge'); await page.locator('[data-delivery="quick"]').click(); await page.locator('[data-trigger="remote"]').click();
  await aim(); const body = await fire(1), before = await read();
  await setRail(false); await page.waitForTimeout(180); const closed = await read();
  const current = closed.projectiles.find(p => p.id === body.id);
  assert.ok(current, `${label}: rail toggle removed live body`);
  assert.ok(current.age > body.age + .05, `${label}: physics stopped advancing while rail was hidden`);
  assert.equal(closed.weapon, before.weapon); assert.equal(closed.snapshot.epoch, before.snapshot.epoch);
  assert.deepEqual(closed.round, before.round); assert.deepEqual(closed.target, before.target);
  await reachable('#detonate'); await page.locator('#detonate').click();
  await wait(id => window.__heping.lastDetonations().some(e => e.id === id), body.id);
  assert.equal((await read()).events.find(e => e.id === body.id).reason, 'remote');
  await setRail(true); assert.equal((await read()).weapon, 'charge');
  record(label, { bodyId: body.id, beforeAge: body.age, hiddenAge: current.age });
}
function compactState(s) {
  const compact = v => ({ schemaVersion: v.schemaVersion, mapId: v.mapId, epoch: v.epoch, voxelCount: v.voxels.length,
    totalCount: v.totalCount, destroyedCount: v.destroyedCount, research: v.research, round: v.round });
  return { ...s, snapshot: compact(s.snapshot), mainSnapshot: compact(s.mainSnapshot) };
}

try {
  // Scenario A: fresh profile. Unlocks are not forged; the six-item library is
  // scrollable, new tools remain locked, and both capacity gates are stated.
  await openContext(); await reachable('#mode-main'); await page.locator('#mode-main').click(); await screen('setup');
  for (const id of ['echo', 'split', 'phase']) assert.equal(await page.locator(`[data-adjust="${id}"][data-delta="1"]`).isDisabled(), true);
  for (const id of ['warehouse', 'bridge', 'tower', 'cantilever']) assert.equal(await page.locator(`[data-scene="${id}"]`).isDisabled(), true);
  await setupGeometry('01-desktop-original-three-part-preparation'); await capture('01-desktop-original-preparation');
  await resize({ width: 1280, height: 720 }, '1280-preparation'); await setupGeometry('02-compact-desktop-internal-scroll'); await capture('02-compact-desktop-preparation');
  await resize(MOBILE_LANDSCAPE, 'mobile-preparation'); await setupGeometry('03-mobile-preparation-scroll', false);
  for (const id of WEAPON_IDS) {
    await reachable(`[data-adjust="${id}"][data-delta="1"]`, 44, { scroll: true });
    await reachable(`[data-adjust="${id}"][data-delta="-1"]`, 44, { scroll: true });
  }
  await reachable('#start-experiment'); await capture('03-mobile-preparation');
  const setupBeforeHelp = await read(); await page.locator('#capacity-help').click();
  const capacity = await page.locator('#capacity-dialog').innerText(); assert.match(capacity, /120/); assert.match(capacity, /420/);
  await reachable('#capacity-dialog .done'); await capture('04-capacity-both-gates'); await page.locator('#capacity-dialog .done').click();
  assert.deepEqual((await read()).setupLoadout, setupBeforeHelp.setupLoadout);
  await resize(DESKTOP, 'desktop-resume'); await page.locator('#setup-back').click(); await page.locator('#mode-free').click(); await screen('setup');
  for (const map of MAP_IDS) assert.equal(await page.locator(`[data-scene="${map}"]`).isDisabled(), false);
  for (const id of ['pulse', 'shock', 'echo', 'split', 'phase']) assert.equal(await page.locator(`[data-free-tool="${id}"]`).isDisabled(), true, 'free mode shares research unlocks');
  await setFreeTools(['charge']); await page.locator('#start-experiment').click(); await screen('playing'); await expectRail(['charge']);
  record('fresh-main-locks-free-maps-and-shared-tool-unlocks');

  // Scenario B: explicitly synthetic damaged schema-5 save. Preserve research,
  // geometry, six-slot current round, consumed stock, and zero new-tool stock.
  const fixture = createSchema5Fixture(createWorld);
  assert.ok(fixture.destroyedCount > 0, 'migration fixture must contain actual damaged geometry');
  await openContext(fixture, 'schema5-damaged-research420-current6-used2');
  // A different free-mode selection must not leak into resumed main inventory.
  await page.locator('#mode-free').click(); await screen('setup'); await setFreeTools(['echo']);
  await page.locator('#start-experiment').click(); await screen('playing'); await select('echo'); await setRail(false); await home();
  await page.locator('#mode-main').click(); await screen('playing'); let s = await read();
  assert.equal(s.snapshot.schemaVersion, 7); assert.equal(s.snapshot.research, 420); assert.deepEqual(s.snapshot.voxels, fixture.voxels);
  assert.equal(s.snapshot.destroyedCount, fixture.destroyedCount); assert.equal(s.round.budget, 6); assert.equal(s.round.used, 2);
  assert.deepEqual(s.round.remaining, { charge: 0, pulse: 1, shock: 1, echo: 0, split: 0, phase: 0 });
  await expectRail(['charge', 'pulse', 'shock']); assert.equal(await page.locator('[data-weapon="charge"]').isDisabled(), true, 'depleted carried tool remains visible and disabled');
  assert.ok(s.round.loadout[s.weapon] > 0 && s.round.remaining[s.weapon] > 0, 'resume selects a carried nonempty tool, not stale free echo or depleted charge');
  await setRail(false);
  assert.equal(await page.locator('#rail-current b').innerText(), await page.locator(`[data-weapon="${s.weapon}"] b`).innerText());
  assert.match(await page.locator('#rail-current strong').innerText(), new RegExp(String(s.round.remaining[s.weapon])));
  await setRail(true); record('main-resume-normalizes-stale-free-tool-and-collapsed-summary');
  const migrated = s.round;
  await page.reload({ waitUntil: 'networkidle' }); await ready(); await page.locator('#mode-main').click(); await screen('playing');
  s = await read(); assert.deepEqual(s.round, migrated); assert.equal(s.snapshot.research, 420); assert.deepEqual(s.snapshot.voxels, fixture.voxels);
  record('schema5-migration-and-repeat-restore-preserve-damaged-world-research-and-exact-ammo');
  await page.locator('#finish-round').click(); await screen('results'); await page.locator('#change-result-scene').click(); await screen('setup');
  await rejectFourthType('main');
  await setLoadout({ charge: 1, pulse: 0, shock: 0, echo: 1, split: 2 });
  await page.locator('[data-scene="bridge"]').scrollIntoViewIfNeeded(); await page.locator('[data-scene="bridge"]').click();
  await page.locator('#start-experiment').click(); await screen('playing'); s = await read();
  assert.equal(s.round.budget, 10); const configured = s.round.loadout; const pristine = s.snapshot.voxels;
  await expectRail(['charge', 'echo', 'split']); record('next-round-capacity10-with-exact-three-type-loadout');
  const savedCurrent = await page.evaluate(() => JSON.parse(localStorage.getItem('hepingmoniqi.first-playable.v1')));
  assert.equal(savedCurrent.schemaVersion, 7, 'explicit start persists schema7');
  await page.reload({ waitUntil: 'networkidle' }); await ready(); await page.locator('#mode-main').click(); await screen('playing');
  s = await read(); assert.deepEqual(s.round, savedCurrent.round); assert.equal(s.snapshot.research, savedCurrent.research); assert.deepEqual(s.snapshot.voxels, pristine);
  await expectRail(['charge', 'echo', 'split']); record('schema7-persisted-round-reload-keeps-exact-stock-and-research');

  // Echo settlement cannot overtake the pending three-pulse sequence.
  await select('echo'); await aim(); const echo = await fire(); assert.equal(echo.state, 'attached'); assert.equal(echo.trigger, 'remote');
  await expectRail(['charge', 'echo', 'split']); assert.equal(await page.locator('[data-weapon="echo"]').isDisabled(), true);
  await page.waitForTimeout(300); assert.equal((await read()).events.length, 0);
  await page.locator('#finish-round').click(); s = await read();
  assert.equal(s.flow, 'ending'); assert.equal(s.modal, false); assert.ok(s.pending > 0); assert.equal(s.events.filter(e => e.weapon === 'echo').length, 1);
  await capture('05-echo-real-pending-sequence'); await screen('results'); s = await read();
  const pulses = s.events.filter(e => e.weapon === 'echo'); assert.equal(pulses.length, 3);
  assert.ok(pulses[1].age - pulses[0].age >= .64 && pulses[2].age - pulses[1].age >= .64);
  const afterEchoResearch = s.snapshot.research; record('echo-three-spaced-real-events-finish-waits', { events: pulses });
  await page.locator('#retry-map').click(); await screen('playing'); s = await read();
  assert.deepEqual(s.round.remaining, configured); assert.deepEqual(s.round.loadout, configured); assert.equal(s.round.used, 0);
  assert.deepEqual(s.snapshot.voxels, pristine); assert.equal(s.snapshot.destroyedCount, 0); assert.equal(s.snapshot.research, afterEchoResearch);
  assert.equal(s.events.length, 0); assert.equal(s.projectiles.length, 0); assert.equal(s.pending, 0);
  await expectRail(['charge', 'echo', 'split']); record('exact-retry-preserves-carried-types-counts-research-rebuilds-world');

  // Split: one paid parent, three physical children, finish awaits all children.
  await select('split'); await page.locator('[data-delivery="quick"]').click(); await page.locator('[data-trigger="automatic"]').click();
  await aim(); await page.locator('#slow').click(); const parent = await fire(); assert.equal(parent.stage, 'parent');
  await page.locator('#pause').click(); await capture('06-split-parent-flight'); await page.locator('#pause').click();
  await wait(() => window.__heping.projectiles().filter(p => p.stage === 'child').length === 3); await page.locator('#pause').click(); s = await read();
  assert.equal(s.round.remaining.split, configured.split - 1); assert.equal(s.round.used, 3);
  assert.equal(s.projectiles.filter(p => p.stage === 'child').length, 3); assert.equal(s.rendered, 3);
  await capture('07-split-three-physical-children'); await page.locator('#finish-round').click(); s = await read();
  assert.equal(s.flow, 'ending'); assert.equal(s.modal, false); assert.ok(s.pending > 0);
  await screen('results'); s = await read(); const children = s.events.filter(e => e.weapon === 'split');
  assert.equal(children.length, 3); assert.ok(children.every(e => e.stage === 'child' && e.reason === 'timer'));
  record('split-one-ammo-three-physical-children-finish-waits', { events: children }); await home();

  // Free mode preserves the main save. Actual three-type selection and visible
  // controls, not hidden state edits, open all five maps and reset pending work.
  const preserved = (await read()).mainSnapshot;
  for (const map of MAP_IDS) {
    await page.locator('#mode-free').click(); await screen('setup');
    if (map === 'courtyard') await rejectFourthType('free');
    await setFreeTools(['charge', 'echo', 'split']);
    await page.locator(`[data-scene="${map}"]`).scrollIntoViewIfNeeded(); await page.locator(`[data-scene="${map}"]`).click();
    assert.equal((await read()).previewMap, map, 'preparation live preview matches the selected map');
    assert.deepEqual((await read()).mainSnapshot, preserved, 'free preparation preview must not mutate main-world damage or stock');
    await page.locator('#start-experiment').click(); await screen('playing'); await expectRail(['charge', 'echo', 'split']);
    s = await read(); assert.equal(s.snapshot.mapId, map); assert.equal(s.events.length, 0); assert.equal(s.projectiles.length, 0);
    for (const id of ['charge', 'echo', 'split']) assert.match(await page.locator('#inventory-' + id).innerText(), /∞/);
    record('free-map-renders-' + map, await pixels());
    if (map === 'courtyard') {
      await gameplayGeometry('08-desktop-tool-rail'); await liveToggle('desktop-toggle-keeps-selection-live-physics-and-fire-controls');
      await page.locator('#reset').click();
    }
    if (map === 'bridge') {
      await select('echo'); await aim(); await fire(); await page.locator('#detonate').click(); await page.locator('#reset').click();
      await page.waitForTimeout(1800); s = await read(); assert.equal(s.events.length, 0); assert.equal(s.projectiles.length, 0); assert.equal(s.pending, 0); assert.equal(s.snapshot.destroyedCount, 0);
      await select('split'); await page.locator('[data-delivery="quick"]').click(); await aim(); await fire(); await page.locator('#reset').click();
      await page.waitForTimeout(2200); s = await read(); assert.equal(s.events.length, 0); assert.equal(s.projectiles.length, 0); assert.equal(s.pending, 0); assert.equal(s.snapshot.destroyedCount, 0);
      record('bridge-echo-split-reset-invalidates-old-epoch-pending-work');
    }
    if (map === 'tower') {
      await capture('09-tower-live-canvas'); await resize(MOBILE_LANDSCAPE, 'landscape-playing');
      await gameplayGeometry('10-landscape-mobile-tool-rail');
      for (const selector of ['#game-home', '#change-scene', '#finish-round', '#pause', '#camera', '#slow', '#settings', '#reset']) await reachable(selector);
      await liveToggle('landscape-real-toggle-aim-fire-and-remote-detonation'); await page.locator('#reset').click();
      await resize(MOBILE_PORTRAIT, 'portrait-playing'); await gameplayGeometry('11-portrait-mobile-tool-rail', { portrait: true });
      await resize(DESKTOP, 'desktop-final');
    }
    await home(); assert.deepEqual((await read()).mainSnapshot, preserved);
  }
  // Scenario C: schema-6 over-limit legacy loadout is not silently truncated.
  // Keep research, damaged geometry, and remaining ammo until explicit reselect.
  const overLimit = createOverLimitSchema6Fixture(createWorld);
  await openContext(overLimit, 'schema6-damaged-research620-four-type-reselection');
  const rawBefore = await page.evaluate(() => localStorage.getItem('hepingmoniqi.first-playable.v1'));
  await page.locator('#mode-main').click(); await screen('setup'); s = await read();
  assert.equal(s.mainSnapshot.schemaVersion, 7); assert.equal(s.mainSnapshot.research, 620);
  assert.deepEqual(s.mainSnapshot.voxels, overLimit.voxels);
  assert.deepEqual(s.mainSnapshot.round, { ...overLimit.round,
    loadout: { ...overLimit.round.loadout, phase: 0 }, remaining: { ...overLimit.round.remaining, phase: 0 } });
  assert.equal(await page.evaluate(() => localStorage.getItem('hepingmoniqi.first-playable.v1')), rawBefore, 'reselection screen must not overwrite legacy save');
  await reachable('#legacy-reselection', 0, { scroll: true });
  assert.match(await page.locator('#legacy-reselection').innerText(), /3|三/);
  await capture('12-legacy-four-type-reselection-preserves-save');
  await setLoadout({ charge: 1, echo: 1, phase: 2 });
  await page.locator('[data-scene="cantilever"]').scrollIntoViewIfNeeded(); await page.locator('[data-scene="cantilever"]').click();
  await page.locator('#start-experiment').click(); await screen('playing'); s = await read();
  assert.equal(s.snapshot.mapId, 'cantilever'); assert.equal(s.snapshot.research, 620);
  assert.deepEqual(s.round.loadout, { charge: 1, pulse: 0, shock: 0, echo: 1, split: 0, phase: 2 });
  assert.equal(s.round.budget, 10); await expectRail(['charge', 'echo', 'phase']); await select('phase');
  assert.match(await page.locator('#inventory-phase').innerText(), /2/);
  await gameplayGeometry('13-phase-cantilever-three-type-rail');
  record('schema6-overlimit-preserved-until-explicit-start-new-phase-and-cantilever', { canvas: await pixels(), round: s.round });
  // The new visible phase model is a real attached entity; activation then
  // produces actual physical-contact events. Native tests cover exact three-hit
  // geometry; this browser sample asserts the observed one-to-three hit result.
  await page.locator('[data-delivery="place"]').click(); await aim(); await page.locator('#slow').click();
  const phase = await fire(3); assert.equal(phase.weapon, 'phase'); assert.equal(phase.state, 'attached'); assert.equal(phase.trigger, 'remote');
  await page.locator('#pause').click(); s = await read(); assert.equal(s.rendered, 1); assert.equal(s.pending, 1); assert.equal(s.events.length, 0);
  await capture('14-phase-real-armed-model'); await page.locator('#pause').click(); await page.locator('#detonate').click();
  await wait(() => window.__heping.lastDetonations().some(e => e.weapon === 'phase'));
  await page.locator('#slow').click(); await wait(() => window.__heping.pendingWork() === 0);
  s = await read(); const phaseEvents = s.events.filter(e => e.weapon === 'phase');
  assert.ok(phaseEvents.length >= 1 && phaseEvents.length <= 3);
  assert.ok(phaseEvents.every(e => e.reason === 'impact' && e.id.startsWith(phase.id + ':phase:')));
  assert.equal(s.round.used, 3); assert.equal(s.round.remaining.phase, 1); assert.equal(s.projectiles.length, 0);
  await capture('15-phase-real-contact-result'); record('phase-visible-entity-one-ammo-real-contact-events', { events: phaseEvents, used: s.round.used, remaining: s.round.remaining.phase });
  assert.deepEqual(evidence.errors, [], 'no runtime errors'); assert.deepEqual(evidence.consoleErrors, [], 'no browser console errors');
  assert.deepEqual(evidence.httpErrors, [], 'no missing assets'); evidence.status = 'passed'; record('all-v07-layout-content-and-three-type-focused-checks-passed');
} catch (error) {
  evidence.status = 'failed'; evidence.failure = String(error);
  evidence.current = await read().then(compactState).catch(() => null);
  evidence.failureGeometry = await inspect(['.scene-panel', '.loadout-panel', '#tool-rail', '#operation-panel', '#tool-rail-toggle']).catch(() => null);
  console.log('V07_FAILURE ' + JSON.stringify({ failure: evidence.failure, state: evidence.current, geometry: evidence.failureGeometry }));
  await capture('failure').catch(captureError => { evidence.captureFailure = String(captureError); }); throw error;
} finally {
  clearTimeout(watchdog); evidence.durationSeconds = Math.round((Date.now() - started) / 1000);
  await fs.writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2));
  console.log('V07_RESULT ' + JSON.stringify({ status: evidence.status, failure: evidence.failure, durationSeconds: evidence.durationSeconds,
    checks: evidence.checks.length, errors: evidence.errors, consoleErrors: evidence.consoleErrors, httpErrors: evidence.httpErrors }));
  await browser.close();
}
