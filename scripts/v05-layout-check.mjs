import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Focused CSS-only follow-up to CI 39930111471. Run on the authorized Ubuntu
// Chrome runner, never as a retry of the authoring sandbox's denied launch.
// Gameplay uses actual visible controls and pointer input. evaluate() only reads
// the live app/DOM: no save/research injection, hidden calls or style overrides.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);
const started = Date.now(), output = 'artifacts/v05-layout', evidence = { checks: [], resizeSamples: [], screenshots: [], errors: [] };
const watchdog = setTimeout(() => { console.error('V05_LAYOUT_TIMEOUT 300-second bound reached'); void browser.close(); }, 300000);
page.on('pageerror', error => evidence.errors.push(String(error)));
await fs.mkdir(output, { recursive: true });
async function mobileResize(label) {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 844, height: 390 });
  const immediate = await inspect([]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  const twoFrames = await inspect([]);
  const sample = { label, immediate, twoFrames }; evidence.resizeSamples.push(sample);
  console.log(`V05_LAYOUT_RESIZE ${JSON.stringify(sample)}`);
  assert.equal(immediate.overflow, false, `${label}: overflow immediately after desktop→mobile resize`);
  assert.equal(twoFrames.overflow, false, `${label}: overflow after two animation frames`);
  await page.waitForTimeout(300);
}
const state = () => page.evaluate(() => {
  const h = window.__heping;
  return { screen: h.screen, mode: h.mode, navigation: h.navigation, mainResearch: h.mainResearch,
    round: h.round(), objective: h.objective(), inventory: h.inventory, projectiles: h.projectiles(),
    activeEffects: h.activeEffects, flow: h.flow, target: h.target, renderedProjectiles: h.renderedProjectiles,
    modal: document.querySelector('#completion-dialog').open, navigationModal: document.querySelector('#navigation-dialog').open };
});
async function waitScreen(screen) {
  await page.waitForFunction(screen => window.__heping?.screen === screen, screen, { timeout: 30000 });
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50, scale: 'css' });
  assert.ok(jpg.length <= 220000, `Screenshot ${name} exceeds 220KB`);
  await fs.writeFile(`${output}/${name}.jpg`, jpg); evidence.screenshots.push({ name, bytes: jpg.length, quality: 50 });
  if (process.env.CI) console.log(`SCREENSHOT_BASE64 v05-layout-${name} ${jpg.toString('base64')}`);
}
async function inspect(selectors) {
  return page.evaluate(selectors => {
    const rect = r => ({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2), left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const describe = e => {
      const style = getComputedStyle(e), r = e.getBoundingClientRect();
      return { tag: e.tagName, id: e.id, class: typeof e.className === 'string' ? e.className : e.className.baseVal,
        text: (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90), rect: rect(r),
        clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight,
        css: { display: style.display, visibility: style.visibility, position: style.position, opacity: style.opacity, width: style.width, inlineWidth: e.style.width, inlineHeight: e.style.height, minWidth: style.minWidth,
          maxWidth: style.maxWidth, overflowX: style.overflowX, overflowY: style.overflowY, whiteSpace: style.whiteSpace,
          flex: style.flex, flexShrink: style.flexShrink, gap: style.gap, gridTemplateColumns: style.gridTemplateColumns } };
    };
    const controls = selectors.map(selector => {
      const e = document.querySelector(selector);
      if (!e) return { selector, reachable: false, missing: true };
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { selector, reachable: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + .5 && r.top >= 0 && r.bottom <= innerHeight + .5 && (hit === e || e.contains(hit)),
        hit: hit ? { tag: hit.tagName, id: hit.id, class: typeof hit.className === 'string' ? hit.className : '' } : null, ...describe(e) };
    });
    const offenders = [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < -.5 || r.right > innerWidth + .5);
    }).map(describe).sort((a, b) => Math.max(0, b.rect.right - innerWidth, -b.rect.left) - Math.max(0, a.rect.right - innerWidth, -a.rect.left)).slice(0, 35);
    const intrinsicOverflows = [...document.querySelectorAll('#scene canvas,.console,.console-main,.weapon-group,.weapon,.experiment-controls,.power,.power input,.action-buttons,.action-buttons button,.setup-columns,.loadout-panel')]
      .filter(e => e.getBoundingClientRect().width > 0).map(describe);
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, canvas: (() => { const e = document.querySelector('canvas'); return e ? { ...describe(e), bitmapWidth: e.width, bitmapHeight: e.height } : null; })(), overflow: document.documentElement.scrollWidth > innerWidth, controls, offenders, intrinsicOverflows };
  }, selectors);
}
async function check(label, selectors) {
  const bounds = await inspect(selectors), check = { label, elapsedSeconds: Math.round((Date.now() - started) / 1000), ...bounds };
  evidence.checks.push(check);
  console.log(`V05_LAYOUT_PROGRESS ${JSON.stringify({ label, elapsedSeconds: check.elapsedSeconds, documentWidth: bounds.documentWidth, viewport: bounds.viewport, overflow: bounds.overflow, controls: bounds.controls.map(c => ({ selector: c.selector, reachable: c.reachable })) })}`);
  if (bounds.overflow || bounds.controls.some(c => !c.reachable)) console.log(`V05_LAYOUT_BOUNDS ${JSON.stringify(check)}`);
  assert.equal(bounds.overflow, false, `${label}: horizontal overflow; bounds=${JSON.stringify(bounds)}`);
  assert.ok(bounds.controls.every(c => c.reachable), `${label}: unreachable controls; bounds=${JSON.stringify(bounds)}`);
  return bounds;
}
async function settings(label, button = '#settings') {
  await page.locator(button).click();
  await check(`${label} settings`, ['#settings-dialog .close', '#mute', '#reduce-motion', '#settings-dialog .done']);
  await page.locator('#settings-dialog .done').click();
}
const gameControls = ['#game-home', '#change-scene', '#finish-round', '#pause', '#camera', '#slow', '#settings', '#fire', '#detonate', '#delivery', '#trigger', '#power', '[data-weapon="charge"]', '[data-weapon="pulse"]', '[data-weapon="shock"]'];
async function aimVisibleSurface() {
  for (const [x, y] of [[430, 165], [470, 180], [390, 180], [510, 165], [430, 205], [550, 205], [350, 205]]) {
    const canvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('canvas'), { x, y });
    if (!canvas) continue;
    await page.mouse.click(x, y);
    if ((await state()).target && !await page.locator('#fire').isDisabled()) return { x, y };
  }
  throw new Error('No visible 844x390 real canvas surface could be aimed for free placement');
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5191', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__heping?.physicsReady, null, { timeout: 30000 }); await waitScreen('home');
  assert.equal((await state()).mainResearch, 0); await mobileResize('home');
  await check('mobile home', ['#mode-main', '#mode-free', '#home-settings', '#home-research']); await capture('01-mobile-home');
  await settings('mobile home', '#home-settings');
  await page.locator('#mode-main').click(); await waitScreen('setup');
  await page.locator('#start-experiment').scrollIntoViewIfNeeded(); await check('mobile main setup', ['#setup-back', '#start-experiment']);
  for (const selector of ['[data-scene="courtyard"]', '[data-scene="warehouse"]', '[data-adjust="charge"][data-delta="-1"]', '[data-adjust="charge"][data-delta="1"]']) {
    await page.locator(selector).scrollIntoViewIfNeeded(); await check(`mobile main setup ${selector}`, [selector]);
  }
  await page.locator('#start-experiment').scrollIntoViewIfNeeded(); await capture('02-mobile-main-setup');
  await page.locator('#start-experiment').click(); await waitScreen('playing');
  assert.equal((await state()).mode, 'main'); await mobileResize('main gameplay'); await check('mobile main gameplay', gameControls); await capture('03-mobile-main-game'); await settings('mobile main gameplay');
  // Zero-shot results are genuine results, not injected UI. No progression or
  // unchanged 16-minute physics coverage needs to be replayed for a CSS fix.
  await page.locator('#finish-round').click(); await page.locator('#completion-dialog').waitFor({ state: 'visible', timeout: 30000 });
  const settled = await state(); assert.equal(settled.round.settled, true); assert.equal(settled.mainResearch, 0);
  await check('mobile explicit results', ['#retry-map', '#change-result-scene', '#result-home', '#observe-scene']); await capture('04-mobile-results');
  assert.equal(Number.parseInt(await page.locator('#result-damage').innerText(), 10), 0); assert.equal(Number.parseInt(await page.locator('#result-earned').innerText(), 10), 0);
  await page.locator('#retry-map').click(); await waitScreen('setup'); await check('mobile retry setup', ['#setup-back', '#start-experiment']);
  await page.locator('#setup-back').click(); await waitScreen('home'); await page.locator('#mode-free').click(); await waitScreen('setup');
  await page.locator('[data-scene="warehouse"]').scrollIntoViewIfNeeded(); assert.equal(await page.locator('[data-scene="warehouse"]').isDisabled(), false); await page.locator('[data-scene="warehouse"]').click();
  await page.locator('#start-experiment').scrollIntoViewIfNeeded(); await check('mobile free setup', ['#setup-back', '#start-experiment']); await capture('05-mobile-free-setup');
  await page.locator('#start-experiment').click(); await waitScreen('playing'); assert.equal((await state()).mode, 'free'); assert.equal((await state()).objective.mapId, 'warehouse');
  await mobileResize('free gameplay'); await check('mobile free gameplay', [...gameControls, '#reset']); await page.locator('#delivery').selectOption('place'); const aim = await aimVisibleSurface();
  await page.locator('#fire').click(); const armed = await state(); assert.equal(armed.projectiles.length, 1); assert.equal(armed.renderedProjectiles, 1); assert.equal(await page.locator('#detonate').isDisabled(), false);
  await check('mobile free armed placement', [...gameControls, '#reset']); await capture('06-mobile-free-game-armed'); await settings('mobile free gameplay');
  await page.locator('#game-home').click(); await check('mobile protected navigation', ['#confirm-leave', '#cancel-leave']); await page.locator('#cancel-leave').click();
  assert.equal((await state()).projectiles.length, 1, 'Cancel leaves real armed object intact');
  await page.locator('#detonate').click(); await page.waitForFunction(() => !window.__heping.projectiles().length, null, { timeout: 15000 });
  await page.locator('#reset').click(); assert.equal((await state()).objective.destroyed, 0); assert.equal((await state()).mainResearch, 0);
  await check('mobile free rebuilt gameplay', [...gameControls, '#reset']);
  await page.locator('#game-home').click(); await page.locator('#confirm-leave').click(); await waitScreen('home'); await check('mobile returned home', ['#mode-main', '#mode-free']);
  assert.deepEqual(evidence.errors, []); evidence.status = 'passed'; evidence.final = await state(); evidence.aim = aim;
  console.log(`V05_LAYOUT_PASSED ${JSON.stringify({ durationSeconds: Math.round((Date.now() - started) / 1000), checks: evidence.checks.length })}`);
} catch (error) {
  evidence.status = 'failed'; evidence.failure = String(error); evidence.current = await state().catch(() => null);
  evidence.failureBounds = await inspect([]).catch(() => null); console.log(`V05_LAYOUT_FAILURE_BOUNDS ${JSON.stringify(evidence.failureBounds)}`);
  await capture('failure').catch(captureError => { evidence.captureFailure = String(captureError); }); throw error;
} finally {
  clearTimeout(watchdog); evidence.durationSeconds = Math.round((Date.now() - started) / 1000);
  await fs.writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2));
  console.log(`V05_LAYOUT_RESULT ${JSON.stringify({ status: evidence.status, failure: evidence.failure, durationSeconds: evidence.durationSeconds, errors: evidence.errors, checks: evidence.checks.map(c => ({ label: c.label, overflow: c.overflow, documentWidth: c.documentWidth, controls: c.controls.map(x => ({ selector: x.selector, reachable: x.reachable })) })) })}`);
  await browser.close();
}
