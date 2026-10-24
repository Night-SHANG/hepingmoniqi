import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameFixture} from './game-fixtures.js';
import {WORLD_BOUNDS} from '../world-layout.js';
for(const map of ['neighborhood','city'] as const)test(`independent terrain: ${map} fills every formal column with eight destructible layers without renumbering existing targets`,()=>{
 const fixture=createGameFixture(map),{halfX,halfZ}=WORLD_BOUNDS[map],width=2*halfX+1,height=2*halfZ+1,masks=new Uint8Array(width*height);
 const ids=new Set<number>();for(const c of fixture.cells){assert.ok(!ids.has(c.id),'Stable IDs cannot collide');ids.add(c.id);if(c.role!=='terrain')continue;
  const {x,y,z}=c.position;assert.ok(Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z));assert.ok(x>=-halfX&&x<=halfX&&z>=-halfZ&&z<=halfZ&&y>=-8&&y<=-1);assert.ok(c.hp>0&&Number.isFinite(c.hp));assert.equal(c.anchor===true,y===-8&&(Math.abs(x)===halfX||Math.abs(z)===halfZ),'Only the actual outer bottom boundary may anchor; old plot edges cannot float as hidden supports');
  const index=(z+halfZ)*width+x+halfX,bit=1<<(-y-1);assert.equal(masks[index]&bit,0,'A column cannot duplicate a soil layer');masks[index]|=bit;
 }
 const gaps=Array.from(masks).filter(mask=>mask!==255).length;assert.equal(gaps,0,`${gaps} formal terrain columns contain a missing layer`);
 const target=fixture.cells.find(c=>c.id===(map==='city'?-4649:-4264));assert.deepEqual(target?.position,map==='city'?{x:-45,y:-1,z:43}:{x:32,y:-1,z:-18});
});
