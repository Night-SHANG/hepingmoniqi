// THROWAWAY topology-only extraction from the current fixtures.ts placement rules.
// Does not construct buildings, 3-layer source terrain, GameCells, or a physics world.
import type { TerrainConfig } from './compact-terrain.ts';
const variants = [[8,10,1],[10,12,2],[12,8,1],[14,12,3],[10,16,2],[16,14,4],[12,16,3],[14,10,5],[16,16,5]] as const;
const rotate = (x:number,z:number,turns:number):[number,number] => turns===1?[-z,x]:turns===2?[-x,-z]:turns===3?[z,-x]:[x,z];
export function legacyLayoutColumns(map:'neighborhood'|'city') {
  const [halfX,halfZ]=map==='city'?[122,102]:[52,42],depth=2*halfZ+1;
  const mask=new Uint8Array((2*halfX+1)*depth);
  const terrain=(minX:number,maxX:number,minZ:number,maxZ:number)=>{for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
    if(x < -halfX || x > halfX || z < -halfZ || z > halfZ)throw new Error('Unexpected footprint outside published bounds');
    mask[(x+halfX)*depth+z+halfZ]=1;
  }};
  const road=(minX:number,maxX:number,minZ:number,maxZ:number)=>terrain(minX-2,maxX+2,minZ-2,maxZ+2);
  const buildings:{x:number;z:number;turns:number;variant:number}[]=[];
  if(map==='neighborhood'){
    [[-28,-24],[0,-24],[28,-24],[-28,0],[28,0],[-28,24],[0,24],[28,24],[0,0]].forEach(([x,z],i)=>buildings.push({x,z,turns:i%4,variant:i}));
    for(const x of [-14,14])road(x-1,x+1,-35,35);
    for(const z of [-12,12])road(-38,38,z-1,z+1);
  }else{
    for(let row=0;row<2;row++)for(let column=0;column<3;column++)for(let lotRow=0;lotRow<2;lotRow++)for(let lotColumn=0;lotColumn<3;lotColumn++)
      buildings.push({variant:buildings.length%9,x:(column-1)*78+(lotColumn-1)*24,z:(row===0?-34:34)+(lotRow===0?-12:12),turns:(row*3+column+lotRow*3+lotColumn)%4});
    for(const z of [-34,0,34])road(-116,116,z-1,z+1);
    for(const x of [-39,39])road(x-1,x+1,-58,58);
  }
  for(const b of buildings){
    const [width,depth]=variants[b.variant],corners=[0,width-1].flatMap(x=>[0,depth-1].map(z=>rotate(x-width/2,z-depth/2,b.turns)));
    const minX=b.x+Math.min(...corners.map(([x])=>x)),maxX=b.x+Math.max(...corners.map(([x])=>x));
    const minZ=b.z+Math.min(...corners.map(([,z])=>z)),maxZ=b.z+Math.max(...corners.map(([,z])=>z));
    terrain(minX-2,maxX+2,minZ-2,maxZ+2);
    if(map==='city'){
      const street=b.z<0?-34:34;terrain(b.x-1,b.x+1,Math.min(b.z,street),Math.max(b.z,street));
      if(street>b.z)road(b.x-1,b.x+1,maxZ+1,street);else road(b.x-1,b.x+1,street,minZ-1);
    }else{
      const street=b.x<0?-14:14;terrain(Math.min(b.x,street),Math.max(b.x,street),b.z-1,b.z+1);
      if(street>b.x)road(maxX+1,street,b.z-1,b.z+1);else road(street,minX-1,b.z-1,b.z+1);
    }
  }
  if(map==='city'){
    for(const x of [-110,-86,-62,-16,8,32,62,86,110]){terrain(x-1,x+1,0,6);terrain(x-2,x+2,4,8);}
    terrain(-3,3,-7,7);
  }else{
    for(const [x,z] of [[-19,-6],[19,-6],[-19,6],[19,6]]){terrain(Math.min(x,x<0?-14:14),Math.max(x,x<0?-14:14),z-1,z+1);terrain(x-2,x+2,z-2,z+2);}
    terrain(7,21,17,23);
  }
  const config:TerrainConfig={map,minX:-halfX,maxX:halfX,minZ:-halfZ,maxZ:halfZ,originalColumn:(x,z)=>mask[(x+halfX)*depth+z+halfZ]===1};
  return {config,originalColumns:mask.reduce((sum,n)=>sum+n,0),buildingCount:buildings.length};
}
