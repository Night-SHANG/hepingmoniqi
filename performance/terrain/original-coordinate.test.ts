import assert from 'node:assert/strict';
import test from 'node:test';
import { CompactTerrain } from './compact-terrain.ts';
test('original coordinates remain owned and stable after removal and dynamic movement',()=>{
 const terrain=new CompactTerrain({map:'test',minX:-2,maxX:2,minZ:-2,maxZ:2,originalColumn:(x,z)=>x===0&&z===0});
 const id=terrain.idAt(0,-1,0)!;
 const p=terrain.originalPosition(id)!;p.x=99;
 terrain.promote(id,'piece-1',{x:9,y:8,z:7},{x:0,y:0,z:0,w:1},'dynamic');
 assert.deepEqual(terrain.originalPosition(id),{x:0,y:-1,z:0});
 terrain.damage(id,1e9);
 assert.deepEqual(terrain.originalPosition(id),{x:0,y:-1,z:0});
 for(let n=-terrain.cellCount;n<0;n++){const at=terrain.originalPosition(n)!;assert.equal(terrain.idAt(at.x,at.y,at.z),n);}
 for(const bad of [0,1,-1.5,NaN,-terrain.cellCount-1])assert.equal(terrain.originalPosition(bad),null);
});
