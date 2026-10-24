import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// This is a synthetic persistence test, not gameplay, damage, or progression
// evidence. It runs only in the already-authorized CI Chrome environment.
assert.equal(process.env.GITHUB_ACTIONS,'true','Run only on the authorized CI browser');
assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome','Persistence QA requires actual Chrome');
const gameURL=new URL(process.env.GAME_URL||'http://127.0.0.1:5191/');
assert.ok(['http:','https:'].includes(gameURL.protocol),'GAME_URL must provide a browser storage origin');
const source=await fs.readFile(new URL('../src/game-save-store.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{fileName:'game-save-store.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0,'The production save module must transpile');
// Import the actual standalone implementation. A runtime relative import would
// resolve incorrectly from data:, so fail before launching rather than testing
// a copied implementation or silently swapping in a fake storage backend.
const parsed=ts.createSourceFile('game-save-store.js',compiled.outputText,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
const runtimeImports=[];
function inspect(node){
 if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)runtimeImports.push(node.moduleSpecifier.getText(parsed));
 if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)runtimeImports.push(node.getText(parsed));
 ts.forEachChild(node,inspect);
}
inspect(parsed);assert.deepEqual(runtimeImports,[],'The persistence module must not need runtime imports for this isolated test');
const moduleURL=`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
const output='artifacts/game-save-browser';await fs.mkdir(output,{recursive:true});
const evidence={scope:'Actual Chrome IndexedDB; synthetic >6 MiB UTF-16 WorldSnapshot-shaped payload; no gameplay claims',origin:gameURL.origin,errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext();
 // Isolated context and a blank same-origin document keep this intentionally
 // synthetic snapshot away from the game and other browser QA fixtures.
 await context.route(gameURL.href,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic save persistence QA</title><p>Persistence-only QA</p>'}));
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>evidence.errors.push(String(error)));
 await page.goto(gameURL.href,{waitUntil:'load'});
 const scenario=async({moduleURL,save})=>{
  const store=await import(moduleURL);
  const snapshot={schemaVersion:9,structural:{schema:'structural-game/v1',syntheticPersistenceFixture:true,payload:'SYNTHETIC_QA_'.repeat(320000)},mapId:'city',completedMaps:[],epoch:7,voxels:[],totalCount:1,destroyedCount:0,research:1500,firstRewardClaimed:false};
  const expected=JSON.stringify(snapshot);
  const legacy=JSON.stringify({schemaVersion:8,epoch:1,voxels:[],totalCount:1,destroyedCount:0,research:40,firstRewardClaimed:false});
  if(save){localStorage.setItem(store.LEGACY_GAME_SAVE_KEY,legacy);await store.saveGameSnapshot(snapshot);}
  const loaded=await store.loadGameSave(),actual=JSON.stringify(loaded);
  if(actual!==expected)throw new Error('Real IndexedDB did not return the exact submitted synthetic snapshot');
  const local=localStorage.getItem(store.GAME_SAVE_KEY),pointer=JSON.parse(local??'null');
  if(!pointer||pointer.storage!=='indexeddb'||!Number.isSafeInteger(pointer.savedAt)||'snapshot' in pointer||local.length>200)throw new Error('Large scenes must leave only a small valid local pointer');
  if(localStorage.getItem(store.LEGACY_GAME_SAVE_KEY)!==legacy)throw new Error('The legacy save key was modified');
  const bytes=new TextEncoder().encode(actual);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  return {utf8Bytes:bytes.length,utf16Bytes:actual.length*2,sha256,pointerBytes:local.length*2,savedAt:pointer.savedAt,legacyUntouched:true};
 };
 evidence.beforeReload=await page.evaluate(scenario,{moduleURL,save:true});
 assert.ok(evidence.beforeReload.utf16Bytes>6*1024*1024,'Fixture must exceed 6 MiB UTF-16, not merely a tiny local save');
 await page.reload({waitUntil:'load'});
 evidence.afterReload=await page.evaluate(scenario,{moduleURL,save:false});
 assert.deepEqual(evidence.afterReload,evidence.beforeReload,'Fresh-page module import must recover identical committed data');
 assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=String(error);throw error;}
finally{
 await fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
 console.log('GAME_SAVE_BROWSER_RESULTS '+JSON.stringify(evidence));
 await browser.close();
}
