// Real UI-only isolated preview A/B. Not formal gameplay acceptance.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.env.QA_OUT??'artifacts/compact-preview';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL??'chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const cdp=await page.context().newCDPSession(page),errors=[],result={scope:'isolated preview, not full game or GPU FPS',runs:[],memory:[]};
page.on('pageerror',error=>errors.push(String(error)));
const mark=(stage,extra={})=>console.log('QA_PROGRESS',JSON.stringify({stage,at:new Date().toISOString(),...extra}));
async function heap(stage,gc=false){if(gc)await cdp.send('HeapProfiler.collectGarbage');const usage=await cdp.send('Runtime.getHeapUsage');result.memory.push({stage,forcedGC:gc,...usage});}
async function screenshot(name){mark('screenshot-start',{name});const bytes=await page.screenshot({type:'jpeg',quality:45,timeout:120000});await fs.writeFile(`${out}/${name}.jpg`,bytes);if(bytes.length<220000)console.log(`SCREENSHOT_BASE64 compact-preview-${name} ${bytes.toString('base64')}`);else console.log('SCREENSHOT_OMITTED_SIZE',name,bytes.length);mark('screenshot-complete',{name,bytes:bytes.length});}
try{
 await page.goto(process.env.GAME_URL??'http://127.0.0.1:5193/',{waitUntil:'networkidle',timeout:120000});
 await page.waitForFunction(()=>!!window.__previewAB);await heap('empty');
 // Two actual button selections per mode, then ten alternating switches.
 for(const [i,mode]of ['old','compact','old','compact',...Array.from({length:10},(_,i)=>i%2?'compact':'old')].entries()){
  mark('select',{i,mode});const count=await page.evaluate(()=>window.__previewAB.records().length);
  await page.locator(`#${mode}`).click({timeout:120000});
  await page.waitForFunction(n=>window.__previewAB.active()&&window.__previewAB.records().length>n,count,{timeout:120000});
  const record=await page.evaluate(()=>window.__previewAB.records().at(-1));assert.equal(record.mode,mode);
  const triangles=mode==='old'?153715*12:203018*2;assert.equal(record.draw.triangles,triangles);
  assert.ok(Number.isFinite(record.cpuBuildMs)&&record.cpuBuildMs>=0);result.runs.push({index:i,...record});
  if(i<2)await screenshot(mode);await heap(`selected-${i}-${mode}`);
 }
 await page.locator('#clear').click();assert.equal(await page.evaluate(()=>window.__previewAB.active()),false);
 await heap('cleared');await heap('cleared',true);
 assert.deepEqual(errors,[]);result.errors=errors;result.note='Screenshot review required. Timings report input dispatch, CPU construction, render submission and later rAF opportunity separately; no compositor/FPS inference.';
 console.log('QA_RESULT',JSON.stringify(result));
}catch(error){result.failure=String(error);result.errors=errors;try{await screenshot('failure');}catch{}throw error;}
finally{await fs.writeFile(`${out}/results.json`,JSON.stringify(result,null,2));await browser.close();}
