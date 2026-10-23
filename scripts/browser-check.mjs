import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
const browser = await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await fs.mkdir('artifacts',{recursive:true});
async function capture(name) { await page.screenshot({path:`artifacts/${name}.png`}); if(process.env.CI){ const jpg=await page.screenshot({type:'jpeg',quality:35}); if(jpg.length<220000) console.log(`SCREENSHOT_BASE64 ${name} ${jpg.toString('base64')}`); } }
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://127.0.0.1:5191',{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await capture('desktop-initial');
const canvasImage=PNG.sync.read(await page.locator('canvas').screenshot());
const colors=new Set(); let bright=0;
for(let y=Math.floor(canvasImage.height*.25);y<canvasImage.height*.75;y+=4)for(let x=Math.floor(canvasImage.width*.25);x<canvasImage.width*.75;x+=4){const k=(y*canvasImage.width+x)*4;const [r,g,b]=canvasImage.data.subarray(k,k+3);colors.add(`${r>>3},${g>>3},${b>>3}`);if(r+g+b>100)bright++;}
if(colors.size<100||bright<500)throw new Error('WebGL canvas does not contain a materially rendered scene');
await page.locator('#dismiss-intro').click();
const state=()=>page.evaluate(()=>{const s=window.__heping.snapshot();return {count:s.voxels.length,total:s.totalCount,destroyed:s.destroyedCount,research:s.research,epoch:s.epoch}});
const initial=await state();
// A drag must not aim/fire. Screen-coordinate search uses only real pointer input.
await page.mouse.move(650,380);await page.mouse.down();await page.mouse.move(720,420,{steps:10});await page.mouse.up();
const afterDrag=await state();
const targetAfterDrag=await page.evaluate(()=>window.__heping.target);
if(targetAfterDrag!==null)throw new Error("Dragging incorrectly set an aim target");
await page.locator('#camera').click();await page.waitForTimeout(500);
let aim=null;
for (let y=310;y<=550&&!aim;y+=40) for(let x=580;x<=880&&!aim;x+=40){await page.mouse.click(x,y);aim=await page.evaluate(()=>window.__heping.target);}
if(!aim)throw new Error('Could not select cottage using real pointer');
await page.locator('#fire').click();await page.waitForTimeout(800);const afterShot=await state();
await capture('desktop-damaged');
await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(500);const afterReload=await state();
await page.locator('#reset').click();const afterReset=await state();
await page.locator('#settings').click();await page.locator('#sandbox').check();await page.locator('.done').click();await page.locator('[data-weapon="shock"]').click();
await page.mouse.click(720,450);let sandboxAim=await page.evaluate(()=>window.__heping.target);
if(!sandboxAim)for (let y=300;y<=550&&!sandboxAim;y+=30){await page.mouse.click(720,y);sandboxAim=await page.evaluate(()=>window.__heping.target);}
await page.locator('#fire').click();await page.waitForTimeout(800);const sandboxShot=await state();
if(sandboxShot.destroyed<=0)throw new Error("Sandbox shot did not destroy any cottage voxels");
await page.locator('#settings').click();await page.locator('#sandbox').uncheck();await page.locator('.done').click();const afterSandbox=await state();
await page.setViewportSize({width:844,height:390});await page.waitForTimeout(700);await capture('mobile-landscape');
const controlsReachable=await page.evaluate(()=>['settings','reset','pause','fire'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&(hit===e||e.contains(hit));}));
await page.locator('#settings').click();await page.locator('.done').click();
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
const evidence={renderColors:colors.size,renderBrightSamples:bright,initial,afterDrag,targetAfterDrag,aim,afterShot,afterReload,afterReset,sandboxShot,afterSandbox,errors,overflow,controlsReachable};
await fs.writeFile('artifacts/browser-results.json',JSON.stringify(evidence,null,2));
if(errors.length||afterDrag.destroyed!==0||afterShot.destroyed<=0||afterReload.destroyed!==afterShot.destroyed||afterReset.destroyed!==0||afterReset.research!==afterShot.research||afterSandbox.research!==afterReset.research||afterSandbox.destroyed!==0||overflow||!controlsReachable)throw new Error(JSON.stringify(evidence));
console.log(JSON.stringify(evidence,null,2));await browser.close();
