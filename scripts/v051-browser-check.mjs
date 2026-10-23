import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';

// Focused v0.5.1 feedback regression; no expensive progression replay. Run on the authorized Ubuntu
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
const started = Date.now(), output = 'artifacts/v051-browser', evidence = { checks: [], resizeSamples: [], screenshots: [], errors: [], httpErrors: [], consoleErrors: [] };
const watchdog = setTimeout(() => { console.error('V051_TIMEOUT 360-second bound reached'); void browser.close(); }, 360000);
page.on('pageerror', error => evidence.errors.push(String(error)));
page.on('response', response => { if(response.status() >= 400) evidence.httpErrors.push({url:response.url(),status:response.status()}); });
page.on('console', message => { if(message.type()==='error') evidence.consoleErrors.push(message.text()); });
await fs.mkdir(output, { recursive: true });
async function mobileResize(label) {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 844, height: 390 });
  const immediate = await inspect([]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  const twoFrames = await inspect([]);
  const sample = { label, immediate, twoFrames }; evidence.resizeSamples.push(sample);
  console.log(`V051_RESIZE ${JSON.stringify(sample)}`);
  assert.equal(immediate.overflow, false, `${label}: overflow immediately after desktop→mobile resize`);
  assert.equal(twoFrames.overflow, false, `${label}: overflow after two animation frames`);
  await page.waitForTimeout(300);
}
const state = () => page.evaluate(() => {
  const h = window.__heping;
  return { screen: h.screen, mode: h.mode, navigation: h.navigation, mainResearch: h.mainResearch, setupLoadout: h.setupLoadout,
    round: h.round(), snapshot: h.snapshot(), objective: h.objective(), inventory: h.inventory, projectiles: h.projectiles(), detonations: h.lastDetonations(),
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
  if (process.env.CI) console.log(`SCREENSHOT_BASE64 v051-browser-${name} ${jpg.toString('base64')}`);
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
  console.log(`V051_PROGRESS ${JSON.stringify({ label, elapsedSeconds: check.elapsedSeconds, documentWidth: bounds.documentWidth, viewport: bounds.viewport, overflow: bounds.overflow, controls: bounds.controls.map(c => ({ selector: c.selector, reachable: c.reachable })) })}`);
  if (bounds.overflow || bounds.controls.some(c => !c.reachable)) console.log(`V051_BOUNDS ${JSON.stringify(check)}`);
  assert.equal(bounds.overflow, false, `${label}: horizontal overflow; bounds=${JSON.stringify(bounds)}`);
  assert.ok(bounds.controls.every(c => c.reachable), `${label}: unreachable controls; bounds=${JSON.stringify(bounds)}`);
  return bounds;
}
const quick='[data-delivery="quick"]', place='[data-delivery="place"]', automatic='[data-trigger="automatic"]', remote='[data-trigger="remote"]';
const controls=['#game-home','#change-scene','#finish-round','#pause','#camera','#slow','#settings','#fire','#detonate',quick,place,automatic,remote,'#power','[data-weapon="charge"]'];
async function pressed(selector,value=true){assert.equal(await page.locator(selector).getAttribute('aria-pressed'),String(value),`${selector} selected state`);}
async function delivery(value,trigger='remote'){
 await page.locator(value==='quick'?quick:place).click();
 await pressed(value==='quick'?quick:place);await pressed(value==='quick'?place:quick,false);
 if(value==='quick')await page.locator(trigger==='automatic'?automatic:remote).click();
 await pressed(value==='quick'&&trigger==='automatic'?automatic:remote);
 await pressed(value==='quick'&&trigger==='automatic'?remote:automatic,false);
 if(value==='place')assert.equal(await page.locator(automatic).isDisabled(),true,'placement cannot silently select automatic');
}
async function desktop(){await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(300);}
async function aimHouse(){
 // Deterministic projection of observed intact cells, then real pointer input.
 // No browser mutation or blind retries of weapon/control selection.
 const s=await state(), camera=new THREE.PerspectiveCamera(42,1440/900,.2,250);
 camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
 const choices=s.snapshot.voxels.filter(v=>v.group==='house').map(v=>{
  const p=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera);
  const nearby=s.snapshot.voxels.filter(n=>n.group==='house'&&Math.hypot(n.position.x-v.position.x,n.position.y-v.position.y,n.position.z-v.position.z)<4.5).length;
  return {x:(p.x+1)*720,y:(1-p.y)*450,score:nearby+(v.position.y<3?30:0)};
 }).filter(p=>p.x>350&&p.x<1250&&p.y>200&&p.y<680).sort((a,b)=>b.score-a.score);
 for(const p of choices.slice(0,30)){
  const canvas=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)===document.querySelector('canvas'),p);
  if(!canvas)continue;
  await page.mouse.click(p.x,p.y);
  if((await state()).target&&!await page.locator('#fire').isDisabled())return p;
 }
 throw new Error('No reachable house aim surface');
}
async function fire(expectedTrigger,expectedState){
 const before=await state();await page.locator('#fire').click();
 const after=await state(), added=after.projectiles.filter(p=>!before.projectiles.some(old=>old.id===p.id));
 assert.equal(added.length,1,'one real fire click creates exactly one physical object');
 assert.equal(added[0].trigger,expectedTrigger);assert.equal(added[0].state,expectedState);
 if(expectedTrigger==='remote')assert.equal(added[0].fuseRemaining,null);
 return added[0];
}
async function detonation(id,reason){
 await page.waitForFunction(id=>window.__heping.lastDetonations().some(e=>e.id===id),id,{timeout:30000});
 assert.equal((await state()).detonations.find(e=>e.id===id).reason,reason);
}
async function capacityHelp(label){
 const before=await state();
 await page.locator('#capacity-help').scrollIntoViewIfNeeded();await page.locator('#capacity-help').click();
 await page.locator('#capacity-dialog').waitFor({state:'visible'});
 const text=await page.locator('#capacity-dialog').innerText();
 for(const threshold of ['6','8','120','10','12'])assert.ok(text.includes(threshold),`${label}: missing capacity ${threshold}`);
 assert.match(text,/后续|未来|未开放|暂未/,'reserved tiers have no invented current thresholds');
 await check(`${label} capacity help`,['#capacity-dialog .close','#capacity-dialog .done']);
 await capture(`${label}-capacity-help`);
 await page.locator('#capacity-dialog .done').click();
 assert.equal(await page.locator('#capacity-dialog').isVisible(),false);
 const after=await state();assert.deepEqual(after.setupLoadout,before.setupLoadout);assert.equal(after.mainResearch,before.mainResearch);
 await page.locator('#capacity-help').click();await page.locator('#capacity-dialog .close').click();
 assert.equal(await page.locator('#capacity-dialog').isVisible(),false);
 assert.deepEqual((await state()).setupLoadout,before.setupLoadout);
}
async function finish(){
 await page.locator('#finish-round').click();await page.locator('#completion-dialog').waitFor({state:'visible',timeout:120000});
 const s=await state();assert.equal(s.round.settled,true);assert.equal(s.projectiles.length,0);return s;
}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__heping?.physicsReady,null,{timeout:30000});await waitScreen('home');
 assert.equal((await state()).mainResearch,0);
 const icon=page.locator('link[rel~="icon"]');assert.ok(await icon.count()>0,'explicit HTML favicon link');
 const iconUrl=new URL(await icon.first().getAttribute('href'),page.url()).href;
 const iconResponse=await page.request.get(iconUrl);assert.equal(iconResponse.status(),200);assert.ok((await iconResponse.body()).length>0);
 const legacyIcon=await page.request.get(new URL('/favicon.ico',page.url()).href);assert.equal(legacyIcon.status(),200);
 evidence.favicon={url:iconUrl,status:iconResponse.status(),legacyStatus:legacyIcon.status()};
 await mobileResize('home');await check('mobile home',['#mode-main','#mode-free']);
 await page.locator('#mode-main').click();await waitScreen('setup');
 await page.locator('#capacity-note').scrollIntoViewIfNeeded();
 assert.match(await page.locator('#capacity-note').innerText(),/120.*8/);
 await check('mobile capacity condition',['#capacity-note']);await capture('01-mobile-capacity-condition');
 const minus=page.locator('[data-adjust="charge"][data-delta="-1"]');
 for(let i=0;i<4;i++)await minus.click();
 assert.equal((await page.locator('#loadout-charge').innerText()).trim(),'2');
 await capacityHelp('mobile');await desktop();await capacityHelp('desktop');await mobileResize('setup after help');
 await page.locator('#start-experiment').click();await waitScreen('playing');
 const initial=await state();assert.deepEqual(initial.round.loadout,{charge:2,pulse:0,shock:0});assert.equal(initial.round.budget,6);
 await check('mobile segmented controls',controls);await capture('02-mobile-segmented-controls');
 await desktop();await delivery('place');evidence.mainAim=await aimHouse();
 const placed=await fire('remote','attached');await mobileResize('armed gameplay');
 await check('mobile placed ordnance',controls);await capture('03-mobile-placement-remote');
 await page.locator('#detonate').click();await detonation(placed.id,'remote');
 const damaged=await state();assert.ok(damaged.mainResearch>0,'actual placement damages building and earns research');
 assert.ok(damaged.snapshot.destroyedCount>0,'retry must rebuild a genuinely damaged scene');
 assert.equal(damaged.modal,false,'damage must not open results automatically');
 const settled=await finish();
 await check('mobile explicit results',['#retry-map','#change-result-scene','#result-home','#observe-scene']);
 assert.match(await page.locator('#round-summary').innerText(),/1.*6/);await capture('04-mobile-results');
 await page.locator('#retry-map').click();await waitScreen('playing');
 const retry=await state();assert.equal(retry.modal,false);assert.equal(retry.mode,'main');
 assert.equal(retry.objective.mapId,initial.objective.mapId);assert.equal(retry.mainResearch,settled.mainResearch);
 assert.deepEqual(retry.round.loadout,initial.round.loadout);assert.deepEqual(retry.round.remaining,initial.round.loadout);
 assert.equal(retry.round.used,0);assert.equal(retry.round.settled,false);assert.ok(retry.snapshot.epoch>settled.snapshot.epoch);
 assert.deepEqual(retry.snapshot.voxels,initial.snapshot.voxels);assert.equal(retry.snapshot.destroyedCount,0);
 evidence.retry={before:settled.round,after:retry.round,research:retry.mainResearch,map:retry.objective.mapId};
 await check('mobile direct retry',controls);await capture('05-mobile-direct-retry');
 await finish();await page.locator('#change-result-scene').click();await waitScreen('setup');
 assert.equal((await state()).modal,false);await page.locator('#start-experiment').scrollIntoViewIfNeeded();await check('change scene opens setup',['#setup-back','#start-experiment']);
 await page.locator('#setup-back').click();await waitScreen('home');await page.locator('#mode-free').click();await waitScreen('setup');
 await page.locator('#start-experiment').click();await waitScreen('playing');await desktop();
 // Unlimited free mode checks actual segment effects without changing main RP.
 const permanent=(await state()).mainResearch;
 await delivery('quick','automatic');await aimHouse();const timed=await fire('automatic','flying');
 assert.ok(timed.fuseRemaining>0);await detonation(timed.id,'timer');
 await delivery('quick','remote');await aimHouse();const launched=await fire('remote','flying');
 await page.waitForFunction(id=>window.__heping.projectiles().some(p=>p.id===id&&p.age>3.2),launched.id,{timeout:30000});
 assert.ok((await state()).projectiles.some(p=>p.id===launched.id),'remote grenade survives ordinary automatic fuse');
 await page.locator('#detonate').click();await detonation(launched.id,'remote');
 await delivery('place');await aimHouse();const attached=await fire('remote','attached');
 await page.locator('#detonate').click();await detonation(attached.id,'remote');
 assert.equal((await state()).mainResearch,permanent,'free controls do not modify permanent research');
 await mobileResize('free final');await check('mobile free segment controls',[...controls,'#reset']);await capture('06-mobile-free-controls');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.httpErrors,[],'no missing/sourced HTTP assets');
 assert.deepEqual(evidence.consoleErrors,[],'no browser console errors including missing resources');
 evidence.status='passed';evidence.final={research:(await state()).mainResearch};
 console.log(`V051_PASSED ${JSON.stringify({durationSeconds:Math.round((Date.now()-started)/1000),checks:evidence.checks.length})}`);
}catch(error){
 evidence.status='failed';evidence.failure=String(error);evidence.current=await state().catch(()=>null);
 evidence.failureBounds=await inspect([]).catch(()=>null);console.log(`V051_FAILURE_BOUNDS ${JSON.stringify(evidence.failureBounds)}`);
 await capture('failure').catch(e=>{evidence.captureFailure=String(e);});throw error;
}finally{
 clearTimeout(watchdog);evidence.durationSeconds=Math.round((Date.now()-started)/1000);
 await fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
 console.log(`V051_RESULT ${JSON.stringify({status:evidence.status,failure:evidence.failure,durationSeconds:evidence.durationSeconds,errors:evidence.errors,httpErrors:evidence.httpErrors,consoleErrors:evidence.consoleErrors})}`);
 await browser.close();
}
