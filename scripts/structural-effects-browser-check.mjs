import {chromium} from '@playwright/test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const browser=await chromium.launch({...(process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],results=[];page.on('pageerror',e=>errors.push(String(e)));
await fs.mkdir('artifacts/structural-effects',{recursive:true});
async function capture(name){await page.screenshot({path:`artifacts/structural-effects/${name}.png`});if(process.env.CI){const jpg=await page.screenshot({type:'jpeg',quality:40});if(jpg.length<220000)console.log(`SCREENSHOT_BASE64 structural-effects-${name} ${jpg.toString('base64')}`);}}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191/structural-lab.html',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__structural?.effects);
 for(const tool of (process.env.QA_SCOPE==='city-effects'?['nova']:['charge','pulse','shock','echo','split','phase','heavy','nova'])){
  console.log(`PROFILE_BEGIN ${tool}`);await page.locator('#reset').click();if(await page.locator('#pause').textContent()==='继续')await page.locator('#pause').click();await page.locator('#slow').check();await page.locator('#tool').selectOption(tool);
  const candidates=await page.evaluate(()=>window.__structural.views().filter(v=>v.role==='building').sort((a,b)=>b.position.y-a.position.y).slice(0,24).map(v=>({id:v.id,p:window.__structural.project(v.id)})).filter(v=>v.p?.visible));
  let clicked=false;for(const c of candidates){if(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)===document.querySelector('#world'),c.p)){await page.mouse.click(c.p.x,c.p.y);clicked=true;break;}}assert.ok(clicked);
  await page.waitForFunction(()=>window.__structural.effects().length>0);await page.locator('#pause').click();const early=await page.evaluate(()=>window.__structural.effects());assert.ok(early.some(e=>e.tool===tool&&e.fire>0));await capture(`${tool}-early`);
  // Early flash needs 1/20 slow motion; the longer nova smoke transition does not.
  if(tool==='nova')await page.locator('#slow').uncheck();
  await page.locator('#pause').click();await page.waitForFunction(tool=>window.__structural.effects().some(e=>e.tool===tool&&e.fire===0&&e.smoke>.1),tool,{timeout:60000});await page.locator('#pause').click();const smoke=await page.evaluate(()=>window.__structural.effects());assert.ok(smoke.some(e=>e.tool===tool&&e.fire===0&&e.smoke>.1));await capture(`${tool}-smoke`);
  results.push({tool,early,smoke,flashCaptured:early.some(e=>e.tool===tool&&e.flash>0)});console.log(`PROFILE_DONE ${tool} flashCaptured=${results.at(-1).flashCaptured}`);
 }
 assert.deepEqual(errors,[]);await fs.writeFile('artifacts/structural-effects/results.json',JSON.stringify(results,null,2));console.log('STRUCTURAL_EFFECT_PROFILE_RESULTS '+JSON.stringify(results));
}finally{await browser.close();}
