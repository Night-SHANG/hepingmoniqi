import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralGameWorld} from './game-world.js';

test('old plot-only v09 city keeps research and spent inventory behind an explicit rebuild gate',async()=>{
 const source=createStructuralGameWorld(),w=createStructuralGameWorld();const save=source.getSnapshot();
 save.mapId='city';save.totalCount=184681;save.research=1403;save.round!.startResearch=1400;save.round!.used=1;save.round!.remaining!.charge=5;
 (save.structural as any).fixtureId='structural-game:v09:city:soil-8';
 try{
  assert.equal(await w.restore(save),true);
  assert.equal(w.getResearch(),1403);assert.deepEqual(w.getRound(),save.round);
  assert.equal(w.migrationPending,true);assert.equal(w.physicsHost,null);assert.equal(w.recordShot('charge'),false);
  assert.equal(w.getSnapshot().totalCount,454913);
  const prior=w.getSnapshot(),bad=structuredClone(save);bad.totalCount--;
  assert.equal(await w.restore(bad),false);assert.deepEqual(w.getSnapshot(),prior);
 }finally{source.suspend();w.suspend();}
});

test('read-only pristine render records share frozen identity and size without sharing positions',()=>{
 const w=createStructuralGameWorld(),[a,b]=w.getVoxels();
 assert.strictEqual(a.size,b.size);assert.strictEqual(a.rotation,b.rotation);
 assert.ok(Object.isFrozen(a.size)&&Object.isFrozen(a.rotation));assert.notStrictEqual(a.position,b.position);
});
