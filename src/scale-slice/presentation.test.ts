import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScaleFixture } from './fixture.js';
import { ScaleAuthority } from './model.js';
import { createScalePresentation } from './presentation.js';
import type { Cell } from '../structural/types.js';

function wall(){
 const cells:Cell[]=[];let id=0;
 for(let x=0;x<4;x++)for(let y=0;y<4;y++)cells.push({id:id++,objectId:y===0?'soil':'wall',role:y===0?'terrain':'building',position:{x,y,z:0},material:y===0?'soil':'stone',color:0xaabbcc,hp:100,maxHp:100});
 const authority=new ScaleAuthority(compileScaleFixture({id:'presentation-wall',cells}));
 return {authority,id:authority.regionViews().find(r=>r.objectId==='wall')!.id};
}

test('camera hysteresis changes representation only, never durability, geometry or rewards',()=>{
 const {authority,id}=wall(),view=createScalePresentation(authority,{nearDistance:5,farDistance:8});
 const before=authority.snapshot(),camera=(z:number)=>({x:1.5,y:2,z});
 assert.equal(view.region(id,camera(4))!.detail,'fine');
 assert.equal(view.region(id,camera(6))!.detail,'fine');
 assert.equal(view.region(id,camera(9))!.detail,'coarse');
 assert.equal(view.region(id,camera(6))!.detail,'coarse');
 assert.equal(view.region(id,camera(4))!.detail,'fine');
 assert.deepEqual(authority.snapshot(),before);
});

// Replacing the far mesh with a bounding box or rebuilding pristine fine cells
// would make either representation cover the precisely removed cell again.
test('near and far share the fine hole mask and authoritative damage after repeated camera switches',()=>{
 const {authority,id}=wall(),view=createScalePresentation(authority,{nearDistance:5,farDistance:8});
 authority.blast({id:'fine-hole',epoch:authority.epoch,sequence:1,position:{x:1,y:2,z:0},radius:.2,damage:100,impulse:0});
 const saved=authority.snapshot();
 const contains=(b:{position:{x:number;y:number;z:number};halfExtents:{x:number;y:number;z:number}})=>Math.abs(b.position.x-1)<b.halfExtents.x&&Math.abs(b.position.y-2)<b.halfExtents.y&&Math.abs(b.position.z)<b.halfExtents.z;
 for(let i=0;i<4;i++)for(const z of [1,30]){
  const result=view.region(id,{x:1,y:2,z})!;
  assert.ok(result.boxes.length>0);
  assert.equal(result.boxes.some(contains),false);
  assert.equal(result.occupiedCellCount,11);
  assert.equal(result.hp,1100);
 }
 assert.deepEqual(authority.snapshot(),saved);
});

test('frame is restricted to requested moving IDs and uses their current rotated pose',()=>{
 const {authority,id}=wall(),view=createScalePresentation(authority);
 const soil=authority.regionViews().filter(r=>r.objectId==='soil').map(r=>r.id);
 authority.applyImpact({id:'detach',epoch:authority.epoch,targetRegionIds:soil,damage:1000});
 const region=authority.region(id)!;
 assert.equal(region.state,'dynamic');
 authority.updateRegionPose(id,{position:{x:10,y:10,z:10},rotation:{x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2}},'rubble');
 const result=view.frame({x:10,y:10,z:11},[id]);
 assert.equal(result.length,1);assert.equal(result[0].regionId,id);
 assert.ok(result[0].boxes.every(b=>b.position.x>=9&&b.position.x<=11&&b.position.y>=8.5&&b.position.y<=11.5&&Math.abs(b.position.z-10)<1e-6));
 assert.ok(result[0].boxes.every(b=>Math.abs(b.rotation.z-Math.SQRT1_2)<1e-6));
 authority.reset();view.reset();assert.equal(view.stats().retainedRegions,0);
});
