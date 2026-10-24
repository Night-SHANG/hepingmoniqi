// Actual browser Web Crypto and support-table parity. No physics/gameplay claim.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out=process.env.QA_OUT??'artifacts/compact-support';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL??'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}}),cdp=await page.context().newCDPSession(page),errors=[];
const result={scope:'actual browser Web Crypto/support proof; not complete game physics or FPS',records:[],memory:[]};
page.on('pageerror',e=>errors.push(String(e)));
async function heap(stage,gc=false){if(gc)await cdp.send('HeapProfiler.collectGarbage');result.memory.push({stage,forcedGC:gc,...await cdp.send('Runtime.getHeapUsage')});}
try{
 await page.goto(process.env.GAME_URL??'http://127.0.0.1:5194/',{waitUntil:'networkidle',timeout:120000});
 await page.waitForFunction(()=>!!window.__supportAB);assert.equal(await page.evaluate(()=>window.isSecureContext&&!!crypto.subtle),true);await heap('initial');
 for(let run=0;run<3;run++){
  console.log('QA_PROGRESS',JSON.stringify({stage:'browser-support-load',run,at:new Date().toISOString()}));
  await page.locator('#load').click({timeout:120000});
  await page.waitForFunction(()=>['passed','error'].includes(window.__supportAB.status),null,{timeout:120000});
  const snapshot=await page.evaluate(()=>window.__supportAB);assert.equal(snapshot.status,'passed',JSON.stringify(snapshot.errors));assert.equal(snapshot.active,true);assert.deepEqual(snapshot.errors,[]);
  const record=snapshot.records.at(-1);assert.equal(record.cellCount,454913);assert.equal(record.steps.length,20);assert.equal(record.exact20CutHashes,true);
  for(const [index,step]of record.steps.entries()){assert.equal(step.step,index+1);assert.match(step.exactOrderedMembershipSha256,/^[a-f0-9]{64}$/);}
  if(result.records.length)assert.deepEqual(record.steps,result.records[0].steps,'Repeated graph builds preserve all exact cut results');
  result.records.push(record);await heap(`active-${run}`);
  await page.locator('#clear').click();const cleared=await page.evaluate(()=>window.__supportAB);assert.equal(cleared.status,'cleared');assert.equal(cleared.active,false);assert.equal(cleared.retainedGraph,null);
  await heap(`cleared-${run}`);await heap(`cleared-${run}`,true);
 }
 assert.deepEqual(errors,[]);result.errors=errors;console.log('QA_SUPPORT_RESULT',JSON.stringify(result));
}catch(error){result.failure=String(error);result.errors=errors;console.log('QA_SUPPORT_FAILURE',JSON.stringify(result));throw error;}
finally{await fs.writeFile(`${out}/results.json`,JSON.stringify(result,null,2));await browser.close();}
