import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixtureModule from './fixture.js';
import type {Cell,SceneFixture} from '../structural/types.js';
const compile=(fixture:SceneFixture)=>(fixtureModule as any).compileScaleFixture(fixture);
const cell=(id:number,x:number,y:number,z:number,patch:Partial<Cell>={}):Cell=>({id,objectId:'wall',position:{x,y,z},role:'building',material:'stone',color:0x888888,hp:10,maxHp:10,...patch});

test('compiler preserves a hollow wall and never fills a missing lattice cell',()=>{
 const f=compile({id:'hole',cells:[cell(1,0,0,0),cell(2,1,0,0),cell(3,0,1,0)]});
 assert.equal(f.cellCount,3);
 const boxes=f.regions.flatMap((r:any)=>r.boxes);
 assert.equal(boxes.reduce((n:number,b:any)=>n+8*b.halfExtents.x*b.halfExtents.y*b.halfExtents.z,0),3);
 assert.equal(boxes.some((b:any)=>Math.abs(1-b.center.x)<b.halfExtents.x&&Math.abs(1-b.center.y)<b.halfExtents.y&&Math.abs(b.center.z)<b.halfExtents.z),false);
});

test('regions split materials and disconnected cells and expose only real adjacency',()=>{
 const f=compile({id:'topology',cells:[cell(1,0,0,0),cell(2,1,0,0,{material:'wood'}),cell(3,3,0,0)]});
 assert.equal(f.regions.length,3);
 const left=f.regions[f.regionIndexByOrdinal[0]],middle=f.regions[f.regionIndexByOrdinal[1]],right=f.regions[f.regionIndexByOrdinal[2]];
 assert.deepEqual(left.neighborIndices,[middle.index]);assert.deepEqual(right.neighborIndices,[]);
 assert.equal(f.contacts.length,1);assert.deepEqual([...f.contacts[0].pairs],[0,1]);
});

test('stable region IDs do not depend on source cell enumeration',()=>{
 const cells=[cell(1,0,0,0),cell(2,4,0,0),cell(3,4,1,0)];
 assert.deepEqual(compile({id:'stable',cells}).regions.map((r:any)=>r.id),compile({id:'stable',cells:[...cells].reverse()}).regions.map((r:any)=>r.id));
});

test('only finite perimeter bottom terrain cells anchor the graph',()=>{
 const cells:Cell[]=[];let id=1;
 for(let x=0;x<3;x++)for(let z=0;z<3;z++)for(let y=-2;y<=-1;y++)cells.push(cell(id++,x,y,z,{objectId:'ground',role:'terrain',material:'soil',anchor:true}));
 cells.push(cell(id++,0,0,0,{anchor:true}));const f=compile({id:'anchors',cells});
 assert.equal([...f.anchors].reduce((n:number,a:any)=>n+a,0),8);
 assert.equal(f.anchors[cells.length-1],0);
});
