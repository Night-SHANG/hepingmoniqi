import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { createSchema7Fixture } from './v08-qa-fixtures.mjs';
import { WEAPON_IDS, MAP_IDS, BUILDING_COUNTS, DESKTOP, MOBILE_LANDSCAPE, OPERATION_CONTROLS,
  distinctBuildings, damagedBuildings, assertAudioBudget, assertFinishWaitEvidence, overlaps, assertInsideViewport,
  assertStationary, assertSideComposition } from './v08-qa-contract.mjs';

// Authorized GitHub standard Ubuntu / preinstalled Chrome ONLY. Do not use this
// script as a retry, escalation or workaround for denied local Chromium.
// Gameplay uses visible controls and real pointer input. evaluate callbacks read
// only. The sole storage write installs an explicitly synthetic legacy fixture
// before page load. This run does NOT claim organic 0-to-1400 progression.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'v08 browser QA is restricted to the authorized GitHub Actions runner');
assert.equal(process.env.QA_BROWSER_CHANNEL, 'chrome', 'Use the authorized standard Chrome channel');
assert.equal(process.env.CHROMIUM_PATH, undefined, 'Executable overrides are not permitted');
const { createWorld } = await tsImport('../src/domain.ts', import.meta.url);
const { TOOLS } = await tsImport('../src/content-catalog.ts', import.meta.url);
const { getScaledBuildingPlacements } = await tsImport('../src/scaled-map-generators.ts', import.meta.url);
const output = 'artifacts/v08-browser', started = Date.now();
const evidence = { checks: [], screenshots: [], fixtures: [], geometry: [], audio: [], errors: [], consoleErrors: [], httpErrors: [],
  scope: 'Real UI interaction, labelled synthetic legacy save. Audio event evidence only, not subjective listening.' };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const watchdog = setTimeout(() => { console.error('V08_TIMEOUT: 10-minute bound reached'); void browser.close(); }, 600000);
let context, page;
const gameUrl = process.env.GAME_URL || 'http://127.0.0.1:5191';
const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
const screen = expected => wait(expected => window.__heping.screen === expected, expected);
const ready = () => wait(() => window.__heping?.physicsReady);
function record(name, detail = {}) {
  const result = { name, seconds: Math.round((Date.now() - started) / 1000), ...detail };
  evidence.checks.push(result); console.log('V08_PROGRESS ' + JSON.stringify(result));
}
async function read() {
  return page.evaluate(() => { const h = window.__heping; return {
    snapshot: h.snapshot(), mainSnapshot: h.mainSnapshot(), round: h.round(), projectiles: h.projectiles(), events: h.lastDetonations(),
    screen: h.screen, mode: h.mode, weapon: h.weapon, target: h.target, flow: h.flow, activeEffects: h.activeEffects,
    pending: h.pendingWork(), rendered: h.renderedProjectiles, setupLoadout: h.setupLoadout, previewMap: h.previewMap,
    lastFinishEvidence: h.lastFinishEvidence, audio: h.audio(), modal: document.querySelector('#completion-dialog').open,
  }; });
}
async function openContext(fixture) {
  if (context) await context.close();
  context = await browser.newContext({ viewport: DESKTOP });
  if (fixture) {
    const name = 'schema7-damaged-research1400-exact-old-stock';
    evidence.fixtures.push({ name, schemaVersion: fixture.schemaVersion, research: fixture.research,
      round: fixture.round, warning: 'Synthetic pre-load migration fixture, not organic gameplay or production boost' });
    await context.addInitScript(({ save, name }) => {
      const marker = 'v08-fixture:' + name;
      if (!sessionStorage.getItem(marker)) {
        localStorage.setItem('hepingmoniqi.first-playable.v1', JSON.stringify(save));
        sessionStorage.setItem(marker, 'synthetic-seeded-before-load');
      }
    }, { save: fixture, name });
  }
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => evidence.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) evidence.httpErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(gameUrl, { waitUntil: 'networkidle' }); await ready(); await screen('home');
}
async function capture(name) {
  assert.ok(evidence.screenshots.length < 7, 'At most seven key screenshots, including failure');
  await page.screenshot({ path: `${output}/${name}.png` });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 50, scale: 'css' });
  assert.ok(jpg.length <= 220000, `${name}: screenshot exceeds 220 KB bounded logging`);
  await fs.writeFile(`${output}/${name}.jpg`, jpg); evidence.screenshots.push({ name, bytes: jpg.length });
  console.log(`SCREENSHOT_BASE64 v08-${name} ${jpg.toString('base64')}`);
}
async function inspect(selectors = []) {
  return page.evaluate(selectors => {
    const describe = el => {
      const r = el.getBoundingClientRect(), css = getComputedStyle(el), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
        reachable: r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none' &&
          r.left >= -.5 && r.right <= innerWidth + .5 && r.top >= -.5 && r.bottom <= innerHeight + .5 && (hit === el || el.contains(hit)),
        hit: hit?.id || hit?.className || hit?.tagName || null, scrollTop: el.scrollTop, clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight, overflowY: css.overflowY };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      documentScroll: { x: scrollX, y: scrollY }, controls: Object.fromEntries(selectors.map(selector => {
        const el = document.querySelector(selector); return [selector, el ? describe(el) : null];
      })), scenes: [...document.querySelectorAll('[data-scene]')].map(describe), loadout: [...document.querySelectorAll('[data-loadout]')].map(describe) };
  }, selectors);
}
async function reachable(selector, minimum = 44, scroll = false) {
  if (scroll) await page.locator(selector).scrollIntoViewIfNeeded();
  const sample = await inspect([selector]), item = sample.controls[selector];
  assert.equal(sample.horizontalOverflow, false, `${selector}: horizontal overflow`);
  assert.ok(item?.reachable, `${selector}: not reachable ${JSON.stringify(item)}`);
  assert.ok(item.rect.width >= minimum - .1 && item.rect.height >= minimum - .1, `${selector}: target smaller than ${minimum}px`);
  return item;
}
async function settleLayout() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function resize(size) { await page.setViewportSize(size); await settleLayout(); assert.equal((await inspect()).horizontalOverflow, false); }
async function pixels() {
  const png = PNG.sync.read(await page.locator('canvas').screenshot()), colors = new Set(); let bright = 0;
  for (let y = png.height * .25 | 0; y < png.height * .75; y += 4) for (let x = png.width * .25 | 0; x < png.width * .75; x += 4) {
    const i = (y * png.width + x) * 4, [r,g,b] = png.data.subarray(i,i+3); colors.add(`${r>>3},${g>>3},${b>>3}`); if (r+g+b>100) bright++;
  }
  assert.ok(colors.size >= 100 && bright >= 500, 'Live WebGL canvas is blank or near uniform'); return { colors: colors.size, bright };
}
async function wheelList(selector, lastSelector) {
  const initial = await inspect([selector]); const r = initial.controls[selector].rect;
  await page.mouse.move((r.left+r.right)/2,(r.top+r.bottom)/2); await page.mouse.wheel(0,-20000);
  await wait(selector => document.querySelector(selector).scrollTop <= 1, selector, 15000);
  const before = await inspect([selector,'#start-experiment','#capacity-section']), scroller = before.controls[selector];
  assert.ok(['auto','scroll'].includes(scroller.overflowY), `${selector}: owns internal overflow`);
  assert.ok(scroller.reachable, `${selector}: actual wheel midpoint is reachable`);
  await page.mouse.move((scroller.rect.left+scroller.rect.right)/2,(scroller.rect.top+scroller.rect.bottom)/2); await page.mouse.wheel(0,20000);
  if (scroller.scrollHeight > scroller.clientHeight + 2) await wait(selector => {
    const el = document.querySelector(selector); return el.scrollTop > 0 && el.scrollHeight-el.clientHeight-el.scrollTop <= 1;
  },selector,15000);
  const after = await inspect([selector,'#start-experiment','#capacity-section']);
  assertStationary(before.controls['#start-experiment'].rect,after.controls['#start-experiment'].rect,`${selector}: pinned start`);
  assertStationary(before.controls['#capacity-section'].rect,after.controls['#capacity-section'].rect,`${selector}: pinned capacity`);
  assert.deepEqual(before.documentScroll,after.documentScroll,`${selector}: page must not move`);
  await reachable(lastSelector,0); await reachable('#start-experiment'); evidence.geometry.push({label:selector,before,after});
}
async function setupGeometry(label, desktop) {
  const s = await inspect(['.scene-panel','.loadout-panel']);
  assert.equal(s.horizontalOverflow,false); assert.equal(s.scenes.length,7); assert.equal(s.loadout.length,8);
  if (desktop) assertSideComposition({viewport:s.viewport,left:s.controls['.scene-panel'].rect,right:s.controls['.loadout-panel'].rect,
    scenes:s.scenes.map(v=>v.rect),loadout:s.loadout.map(v=>v.rect)});
  await wheelList('.scene-choices','[data-scene="city"]'); await wheelList('.loadout-rows','[data-loadout="nova"]');
  await reachable('#capacity-help'); record(label,{canvas:await pixels()});
}
async function setRail(open) {
  const toggle = page.locator('#tool-rail-toggle');
  assert.equal(await toggle.getAttribute('aria-controls'),'tool-rail-content');
  if ((await toggle.getAttribute('aria-expanded')==='true')!==open) { await reachable('#tool-rail-toggle'); await toggle.click(); }
  await settleLayout(); assert.equal(await toggle.getAttribute('aria-expanded'),String(open));
}
async function expectRail(types) {
  await setRail(true);
  const actual=await page.locator('#tool-rail-content [data-weapon]').evaluateAll(elements=>elements.filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.weapon));
  assert.deepEqual(actual,WEAPON_IDS.filter(id=>types.includes(id))); assert.ok(actual.length<=3);
}
async function gameplayGeometry(label, screenshot) {
  await expectRail(['charge','heavy','nova']);
  for (const id of ['charge','heavy','nova']) await reachable(`[data-weapon="${id}"]`,44,true);
  const expanded=await inspect(['#tool-rail','#tool-rail-content','#operation-panel']);
  assertInsideViewport(expanded.controls['#operation-panel'].rect,expanded.viewport,'Separate action panel');
  assert.equal(overlaps(expanded.controls['#tool-rail'].rect,expanded.controls['#operation-panel'].rect),false,'Tool rail covers action panel');
  for(const selector of OPERATION_CONTROLS) await reachable(selector);
  const before=await read(); await setRail(false); assert.equal(await page.locator('#tool-rail-content').isVisible(),false);
  const collapsed=await inspect(['#tool-rail','#operation-panel']);
  assertStationary(expanded.controls['#operation-panel'].rect,collapsed.controls['#operation-panel'].rect,'Action panel independent of rail');
  const after=await read(); assert.equal(after.weapon,before.weapon); assert.deepEqual(after.round,before.round); assert.equal(after.snapshot.epoch,before.snapshot.epoch);
  for(const selector of OPERATION_CONTROLS) await reachable(selector);
  evidence.geometry.push({label,expanded,collapsed}); if(screenshot) await capture(screenshot); await setRail(true); record(label);
}
async function select(id) { await setRail(true); await reachable(`[data-weapon="${id}"]`,44,true); await page.locator(`[data-weapon="${id}"]`).click(); assert.equal((await read()).weapon,id); }
async function setFreeTools(types) {
  for(const id of WEAPON_IDS){const b=page.locator(`[data-free-tool="${id}"]`);if(await b.getAttribute('aria-pressed')==='true'&&!types.includes(id)){await b.scrollIntoViewIfNeeded();await b.click();}}
  for(const id of types){const b=page.locator(`[data-free-tool="${id}"]`);if(await b.getAttribute('aria-pressed')!=='true'){await b.scrollIntoViewIfNeeded();await b.click();}assert.equal(await b.getAttribute('aria-pressed'),'true');}
}
async function setLoadout(desired) {
  for(const id of WEAPON_IDS) while(Number(await page.locator('#loadout-'+id).innerText())>(desired[id]??0)) {const b=page.locator(`[data-adjust="${id}"][data-delta="-1"]`);await b.scrollIntoViewIfNeeded();await b.click();}
  for(const id of WEAPON_IDS) while(Number(await page.locator('#loadout-'+id).innerText())<(desired[id]??0)) {const b=page.locator(`[data-adjust="${id}"][data-delta="1"]`);await b.scrollIntoViewIfNeeded();assert.equal(await b.isDisabled(),false);await b.click();}
}
async function chooseMap(id) {
  const b=page.locator(`[data-scene="${id}"]`);await b.scrollIntoViewIfNeeded();await b.click();await wait(id=>window.__heping.previewMap===id,id);
}
async function start() {await reachable('#start-experiment');await page.locator('#start-experiment').click();await screen('playing');}
async function home() {
  if(await page.locator('#completion-dialog').evaluate(el=>el.open)) {await page.locator('#result-home').click();await screen('home');return;}
  await page.locator('#game-home').click();if(await page.locator('#navigation-dialog').evaluate(el=>el.open))await page.locator('#confirm-leave').click();await screen('home');
}
async function fire() {
  const before=await read();await reachable('#fire');await page.locator('#fire').click();const after=await read();
  const body=after.projectiles.find(p=>!before.projectiles.some(old=>old.id===p.id));assert.ok(body,'Visible fire must create a real physical entity');
  if(after.mode==='main'){assert.equal(after.round.used,before.round.used+TOOLS[after.weapon].cost);for(const id of WEAPON_IDS)assert.equal(after.round.remaining[id],before.round.remaining[id]-(id===after.weapon?1:0));}
  assertAudioBudget(after.audio);return body;
}
async function audioFor(body,kind,samples) {
  await wait(({id,kind,samples})=>{
    const a=window.__heping.audio();return a.playedEventKeys.some(key=>{try{const v=JSON.parse(key);return v[1]===id&&v[2]===kind;}catch{return false;}})&&samples.every(sample=>a.playedSampleIds.includes(sample));
  },{id:body.id,kind,samples});
  const audio=(await read()).audio;assertAudioBudget(audio);assert.deepEqual(audio.failures,[]);
  assert.equal(new Set(audio.acceptedEventKeys).size,audio.acceptedEventKeys.length,'Each admitted gameplay event key occurs once');
  evidence.audio.push({bodyId:body.id,weapon:body.weapon,kind,expectedSamples:samples,diagnostics:audio});
}
async function reset() {
  const before=await read();await page.locator('#reset').click();await wait(epoch=>window.__heping.snapshot().epoch!==epoch,before.snapshot.epoch);
  const s=await read();assert.equal(s.pending,0);assert.equal(s.projectiles.length,0);assert.equal(s.events.length,0);assert.equal(s.activeEffects,false);assert.equal(s.snapshot.destroyedCount,0);
  assert.ok(s.audio.activeVoices.every(v=>v.epoch===s.snapshot.epoch),'Reset leaves no old-epoch audio source');return s;
}
function compact(s) {
  const snap=v=>({schemaVersion:v.schemaVersion,mapId:v.mapId,epoch:v.epoch,voxelCount:v.voxels.length,buildings:distinctBuildings(v.voxels).length,totalCount:v.totalCount,destroyedCount:v.destroyedCount,research:v.research,round:v.round});
  return {...s,snapshot:snap(s.snapshot),mainSnapshot:snap(s.mainSnapshot)};
}
// Native preflight uses a separate domain instance. It never calls a mutating
// browser-game API or changes browser research. Actual targets still come from
// real mouse clicks and the scene's read-only projection function.
function affectedBlocks(buildings,map='city') {
  const placements=getScaledBuildingPlacements(map), blocks=new Map(placements.map(b=>[b.objectId,b.blockId]));
  for(const id of buildings)assert.ok(blocks.has(id),`Unknown building identity ${id}`);
  return [...new Set(buildings.map(id=>blocks.get(id)))].sort();
}
function predictDamage(target,weapon) {
  const world=createWorld();assert.equal(world.loadMap('city',true),true);const before=world.getSnapshot();
  const result=world.damage({id:'native-read-only-browser-preflight',epoch:world.epoch,weapon,power:1,target,reward:false});
  assert.equal(result.accepted,true);const buildings=damagedBuildings(before.voxels,world.getSnapshot().voxels);
  return {buildings,blocks:affectedBlocks(buildings),removed:result.removed.length,detached:result.detached.length};
}
async function clickWorld(point,{ground=false}={}) {
  const projected=await page.evaluate(point=>window.__heping.project(point),point);
  if(!projected||!Number.isFinite(projected.x)||!Number.isFinite(projected.y)||projected.visible===false)return null;
  const exposed=await page.evaluate(({x,y})=>x>5&&y>5&&x<innerWidth-5&&y<innerHeight-5&&document.elementFromPoint(x,y)===document.querySelector('canvas'),projected);
  if(!exposed)return null;
  await page.mouse.click(projected.x,projected.y);const state=await read(),target=state.target;
  if(!target||Math.hypot(target.x-point.x,target.z-point.z)>1.1||(ground&&Math.abs(target.y)>.6))return null;
  return {target,pixel:{x:projected.x,y:projected.y}};
}
async function aimCityGround(exactTarget) {
  await page.locator('#camera').click();await settleLayout();
  if(exactTarget){const aim=await clickWorld(exactTarget,{ground:true});assert.ok(aim,'Same exact ground point must remain reachable on a pristine city');return aim;}
  const candidates=[];
  for(const z of [0,8,-8,16,-16])for(const x of [0,8,-8,20,-20,38,-38])candidates.push({x,y:0,z});
  for(const point of candidates){
    const aim=await clickWorld(point,{ground:true});if(!aim)continue;
    const nova=predictDamage(aim.target,'nova'),charge=predictDamage(aim.target,'charge');
    if(nova.buildings.length>=2&&nova.blocks.length>=2&&nova.buildings.length>charge.buildings.length){
      record('native-preflight-selects-real-pointer-ground-target',{...aim,predictedNova:nova,predictedCharge:charge});return aim;
    }
  }
  throw new Error('No real exposed city ground point reaches buildings in at least two city blocks with nova');
}
async function detonate(body,{pauseAfter=false}={}) {
  await reachable('#detonate');await page.locator('#detonate').click();
  // Detonation is disabled while paused. Pause immediately AFTER the real
  // detonate click, before diagnostics/audio waits or slow screenshot encoding.
  if(pauseAfter){await page.locator('#pause').click();assert.equal(await page.locator('#pause').evaluate(el=>el.classList.contains('active')),true);}
  await wait(id=>window.__heping.lastDetonations().some(e=>e.id===id),body.id);
  const s=await read(),event=s.events.find(e=>e.id===body.id);assert.equal(event.reason,'remote');assert.equal(event.weapon,body.weapon);return s;
}
async function settleEffects() {await wait(()=>window.__heping.pendingWork()===0&&!window.__heping.activeEffects,undefined,60000);}
async function placeAt(weapon,target) {
  await select(weapon);await page.locator('[data-delivery="place"]').click();const aim=await aimCityGround(target);const body=await fire();
  assert.equal(body.state,'attached');assert.equal(body.trigger,'remote');assert.ok(body.hostVoxelId===null,'Ground placement must not falsely attach to a house');
  assert.ok(Math.hypot(body.position.x-aim.target.x,body.position.z-aim.target.z)<.2);return {body,aim};
}
try {
  // A. Genuine fresh profile, no synthetic save. Preserve the default courtyard
  // and side-by-side desktop layout while lists grow to seven/eight entries.
  await openContext();await page.locator('#mode-main').click();await screen('setup');
  assert.equal((await read()).mainSnapshot.research,0);
  for(const id of ['heavy','nova'])assert.equal(await page.locator(`[data-adjust="${id}"][data-delta="1"]`).isDisabled(),true);
  for(const id of ['neighborhood','city'])assert.equal(await page.locator(`[data-scene="${id}"]`).isDisabled(),true);
  await setupGeometry('fresh-desktop-seven-map-eight-tool-side-layout',true);await capture('01-default-desktop-preparation');
  await resize(MOBILE_LANDSCAPE);await setupGeometry('fresh-landscape-internal-wheel-scroll',false);await capture('02-mobile-preparation');
  await resize(DESKTOP);await page.locator('#setup-back').click();await page.locator('#mode-free').click();await screen('setup');
  for(const id of MAP_IDS)assert.equal(await page.locator(`[data-scene="${id}"]`).isDisabled(),false,'Free mode opens all maps');
  for(const id of ['heavy','nova'])assert.equal(await page.locator(`[data-free-tool="${id}"]`).isDisabled(),true,'Free tools still share research unlocks');
  for(const [map,count] of Object.entries(BUILDING_COUNTS)){
    await chooseMap(map);await setFreeTools(['charge']);await start();let s=await read();
    assert.equal(s.snapshot.mapId,map);assert.equal(distinctBuildings(s.snapshot.voxels).length,count,'Count actual separate house objectIds, not visual shells');
    assert.equal(s.snapshot.destroyedCount,0);assert.equal(s.mainSnapshot.research,0);if(map==='city')assert.equal(affectedBlocks(distinctBuildings(s.snapshot.voxels)).length,6);await pixels();
    await capture(map==='neighborhood'?'03-neighborhood-nine-default-scene':'04-city-thirty-six-default-scene');
    record(`fresh-free-${map}-actual-distinct-buildings`,{count,voxels:s.snapshot.voxels.length,blocks:map==='city'?affectedBlocks(distinctBuildings(s.snapshot.voxels)).length:1});
    await home();if(map==='neighborhood'){await page.locator('#mode-free').click();await screen('setup');}
  }
  // B. Explicitly synthetic schema-7 legacy migration, including real prior
  // damaged geometry, spent stock, six old inventory keys and 1400 research.
  const fixture=createSchema7Fixture(createWorld);await openContext(fixture);
  const raw=await page.evaluate(()=>localStorage.getItem('hepingmoniqi.first-playable.v1'));
  await page.locator('#mode-main').click();await screen('playing');let s=await read();
  assert.equal(s.snapshot.schemaVersion,8);assert.equal(s.snapshot.research,1400);assert.deepEqual(s.snapshot.voxels,fixture.voxels);
  assert.equal(s.snapshot.destroyedCount,fixture.destroyedCount);
  const expectedRound={...fixture.round,loadout:{...fixture.round.loadout,heavy:0,nova:0},remaining:{...fixture.round.remaining,heavy:0,nova:0}};
  assert.deepEqual(s.round,expectedRound);await expectRail(['charge','echo','phase']);
  assert.equal(await page.evaluate(()=>localStorage.getItem('hepingmoniqi.first-playable.v1')),raw,'Read/resume must not overwrite original legacy save');
  await page.reload({waitUntil:'networkidle'});await ready();await page.locator('#mode-main').click();await screen('playing');s=await read();
  assert.deepEqual(s.round,expectedRound);assert.deepEqual(s.snapshot.voxels,fixture.voxels);assert.equal(s.snapshot.research,1400);
  record('schema7-reload-preserves-damaged-geometry-research-exact-old-stock-new-zero');
  await page.locator('#finish-round').click();await screen('results');await page.locator('#change-result-scene').click();await screen('setup');
  // Six occupied slots leave four free, enough for echo's three-slot cost;
  // rejection therefore proves the type gate, not merely the capacity gate.
  await setLoadout({charge:1,pulse:1,heavy:1});
  const fourth=page.locator('[data-adjust="echo"][data-delta="1"]');await fourth.scrollIntoViewIfNeeded();assert.equal(await fourth.isDisabled(),true);
  await page.locator('[data-adjust="pulse"][data-delta="-1"]').scrollIntoViewIfNeeded();await page.locator('[data-adjust="pulse"][data-delta="-1"]').click();
  await fourth.scrollIntoViewIfNeeded();assert.equal(await fourth.isDisabled(),false,'Reducing a type to zero releases its selection slot');
  await setLoadout({charge:2,heavy:1,nova:1});assert.match(await page.locator('#capacity-value').innerText(),/10\s*\/\s*10/);
  await chooseMap('city');await start();s=await read();assert.equal(s.round.budget,10);assert.equal(s.round.used,0);
  assert.equal(s.round.remaining.heavy,1);assert.equal(s.round.remaining.nova,1);await gameplayGeometry('desktop-three-type-rail-and-separate-action-panel');
  await resize(MOBILE_LANDSCAPE);await gameplayGeometry('mobile-three-type-collapse-keeps-actions-clear','05-city-mobile-rail-collapsed');await resize(DESKTOP);
  await select('heavy');await page.locator('[data-delivery="quick"]').click();await page.locator('[data-trigger="remote"]').click();
  const centralAim=await aimCityGround();await page.locator('#slow').click();const heavy=await fire();
  assert.equal(heavy.state,'flying');assert.equal(heavy.weapon,'heavy');assert.ok(Math.hypot(heavy.position.x,heavy.position.z)<=300,'Actual city launch origin stays inside physics radial budget');assert.equal((await read()).events.length,0,'Launch does not instantly detonate');
  await wait(id=>window.__heping.projectiles().some(p=>p.id===id&&p.age>.08),heavy.id);
  const movingState=await read(),flying=movingState.projectiles.find(p=>p.id===heavy.id);assert.ok(flying,'Actual city projectile survives beyond first physics frame');assert.ok(movingState.rendered>=1);assert.ok(Math.hypot(flying.position.x,flying.position.z)<=300,'Live projectile remains inside physics radial budget');assert.ok(Math.hypot(flying.position.x-heavy.position.x,flying.position.y-heavy.position.y,flying.position.z-heavy.position.z)>.05,'Projectile physically moves');
  await audioFor(heavy,'launch',['cosmic-transition']);await detonate(heavy);await audioFor(heavy,'detonate',['split-burst-long']);
  await page.locator('#slow').click();await settleEffects();assert.equal((await read()).modal,false,'Damage/effect completion never opens results automatically');
  record('heavy-real-projectile-flight-cost3-distinct-sample-no-auto-modal',{bodyId:heavy.id,initial:heavy.position,moved:flying.position});
  const placed=await placeAt('nova',centralAim.target);await audioFor(placed.body,'place',['cosmic-engine-bed']);await page.locator('#slow').click();
  const beforeNova=(await read()).snapshot;await detonate(placed.body,{pauseAfter:true});await audioFor(placed.body,'detonate',['city-explosion-body','city-distant-low']);
  s=await read();assert.equal(s.round.used,8);assert.equal(s.round.remaining.nova,0);assert.equal(s.activeEffects,true);assert.equal(s.modal,false);
  const mainNovaBuildings=damagedBuildings(beforeNova.voxels,s.snapshot.voxels);assert.ok(mainNovaBuildings.length>=2);assert.ok(affectedBlocks(mainNovaBuildings).length>=2);
  await capture('06-nova-real-multiblock-effects');await page.locator('#finish-round').click();s=await read();
  assertFinishWaitEvidence(s);
  await screen('results');s=await read();assert.equal(s.activeEffects,false);assert.equal(s.pending,0);assert.equal(s.modal,true);
  record('nova-cost5-multiblock-ground-remote-finish-waits-for-effects',{buildings:mainNovaBuildings,blocks:affectedBlocks(mainNovaBuildings),finish:s.lastFinishEvidence});
  await home();const preserved=(await read()).mainSnapshot;
  // C. Actual free city choice with three carried types, equal-point old/new
  // comparison, live reset cancellation and main-save isolation.
  await page.locator('#mode-free').click();await screen('setup');await setFreeTools(['charge','heavy','nova']);
  const freeFourth=page.locator('[data-free-tool="pulse"]');await freeFourth.scrollIntoViewIfNeeded();assert.equal(await freeFourth.isDisabled(),true);
  await chooseMap('city');await start();await expectRail(['charge','heavy','nova']);
  for(const id of ['charge','heavy','nova'])assert.match(await page.locator('#inventory-'+id).innerText(),/∞/);
  const freeAim=await aimCityGround(),original=(await read()).snapshot;
  const old=await placeAt('charge',freeAim.target);await detonate(old.body);await audioFor(old.body,'detonate',['grenade-blast']);
  let oldState=await read();const oldBuildings=damagedBuildings(original.voxels,oldState.snapshot.voxels);await settleEffects();assert.equal((await read()).modal,false);
  await reset();const nova=await placeAt('nova',freeAim.target);await page.locator('#slow').click();await detonate(nova.body,{pauseAfter:true});await audioFor(nova.body,'detonate',['city-explosion-body','city-distant-low']);
  s=await read();const novaBuildings=damagedBuildings(original.voxels,s.snapshot.voxels),novaBlocks=affectedBlocks(novaBuildings);
  assert.ok(novaBuildings.length>oldBuildings.length,'Nova must affect more real buildings than charge at the same real ground point');assert.ok(novaBlocks.length>=2);
  assert.equal(s.activeEffects,true,'Reset scenario must begin while nova core effects are actually active');assert.equal(s.modal,false);assert.equal(s.snapshot.research,0,'Free mode grants no research');assert.deepEqual(s.mainSnapshot,preserved,'Free destruction must not mutate main save');
  record('equal-real-ground-point-nova-affects-more-buildings-than-old-charge',{target:freeAim.target,oldBuildings,novaBuildings,novaBlocks});
  const resetState=await reset();
  // A real unpaused simulation sample proves old delayed events do not reappear.
  await select('heavy');await page.locator('[data-delivery="quick"]').click();await page.locator('[data-trigger="remote"]').click();await aimCityGround(freeAim.target);
  await page.locator('#slow').click();const pending=await fire();assert.equal(pending.state,'flying');const clean=await reset();
  const cleanEpoch=clean.snapshot.epoch;
  await page.waitForTimeout(1800);s=await read();assert.equal(s.snapshot.epoch,cleanEpoch);assert.equal(s.events.length,0);assert.equal(s.projectiles.length,0);assert.equal(s.pending,0);assert.equal(s.activeEffects,false);assert.equal(s.snapshot.destroyedCount,0);
  assert.deepEqual(s.mainSnapshot,preserved);assertAudioBudget(s.audio);assert.deepEqual(s.audio.failures,[]);
  record('reset-cancels-active-nova-and-flying-heavy-old-epoch-work',{effectResetEpoch:resetState.snapshot.epoch,physicsResetEpoch:cleanEpoch});
  // Mute uses the actual settings control, not a diagnostics mutation.
  await page.locator('#settings').click();await page.locator('#mute').check();assert.equal((await read()).audio.muted,true);assert.equal((await read()).audio.activeVoices.length,0);
  await page.locator('#mute').uncheck();await page.locator('#settings-dialog .done').click();assert.equal((await read()).audio.muted,false);record('real-settings-mute-stops-sources-and-unmutes');
  assert.deepEqual(evidence.errors,[],'No runtime errors');assert.deepEqual(evidence.consoleErrors,[],'No browser console errors');assert.deepEqual(evidence.httpErrors,[],'No missing assets or HTTP errors');
  evidence.status='passed';record('all-v08-city-growth-migration-ui-physics-effects-audio-focused-checks-passed');
} catch(error) {
  evidence.status='failed';evidence.failure=String(error);evidence.current=await read().then(compact).catch(()=>null);
  evidence.failureGeometry=await inspect(['.scene-panel','.loadout-panel','#tool-rail','#operation-panel']).catch(()=>null);
  console.log('V08_FAILURE '+JSON.stringify({failure:evidence.failure,state:evidence.current,geometry:evidence.failureGeometry}));
  if(evidence.screenshots.length<7)await capture('failure').catch(error=>{evidence.captureFailure=String(error);});throw error;
} finally {
  clearTimeout(watchdog);evidence.durationSeconds=Math.round((Date.now()-started)/1000);await fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
  console.log('V08_RESULT '+JSON.stringify({status:evidence.status,failure:evidence.failure,durationSeconds:evidence.durationSeconds,checks:evidence.checks.length,screenshots:evidence.screenshots.length,errors:evidence.errors,consoleErrors:evidence.consoleErrors,httpErrors:evidence.httpErrors}));
  await browser.close();
}
