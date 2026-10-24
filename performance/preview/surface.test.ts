import {test} from 'node:test';import assert from 'node:assert/strict';import {buildSurface} from './surface.js';
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
test('implicit eight-layer surface matches a dense oracle including cavity walls and colors',()=>{
 const b={halfX:2,halfZ:2,depth:8},cells=[{position:{x:0,y:0,z:0},color:0x992200},{position:{x:0,y:1,z:0},color:0x992200},{position:{x:1,y:1,z:0},color:0x992200}];
 const dense=new Map<string,number>();for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(let d=1;d<=8;d++)dense.set(key(x,-d,z),d===1?0x884411:0x443322);for(const c of cells)dense.set(key(c.position.x,c.position.y,c.position.z),c.color);
 const expected:string[]=[];for(const [k,color] of dense){const [x,y,z]=k.split(',').map(Number);dirs.forEach(([dx,dy,dz],face)=>{if(!dense.has(key(x+dx,y+dy,z+dz)))expected.push(`${k}:${face}:${color}`);});}
 const result=buildSurface(b,cells,(_x,y,_z)=>y===-1?0x884411:0x443322);assert.deepEqual(result.faces.map(f=>`${key(f.x,f.y,f.z)}:${f.face}:${f.color}`).sort(),expected.sort());assert.equal(result.stats.terrainObjectCount,0);assert.equal(result.positions.length,result.faces.length*18);
});
