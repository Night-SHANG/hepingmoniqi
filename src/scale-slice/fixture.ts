import {createCompactGameFixture,createDenseFixture} from '../compact/fixture.js';
import type {CompactFixture,CompactBounds} from '../compact/fixture.js';
import type {Cell,Matter,Point,SceneFixture} from '../structural/types.js';

export interface ScaleBox {center:Point;halfExtents:Point}
export interface ScaleRegion {
 readonly id:string;readonly index:number;readonly material:Matter;readonly role:Cell['role'];readonly objectId:string;
 readonly cellOrdinals:Uint32Array;readonly boxes:readonly ScaleBox[];readonly center:Point;readonly bounds:CompactBounds;
 readonly maxHp:number;readonly initialHp:number;readonly objectiveWeight:number;readonly color:number;
 readonly neighborIndices:readonly number[];
}
export interface ScaleContact {readonly a:number;readonly b:number;readonly pairs:Uint32Array}
export interface ScaleFixture {
 readonly source:CompactFixture;readonly id:string;readonly signature:string;readonly cellCount:number;readonly structureCount:number;readonly terrainCount:number;
 readonly buildingCount:number;readonly bounds:Readonly<CompactBounds>;readonly regions:readonly ScaleRegion[];readonly contacts:readonly ScaleContact[];
 readonly cellIds:Float64Array;readonly x:Int32Array;readonly y:Int32Array;readonly z:Int32Array;
 readonly initialHp:Float64Array;readonly maxHp:Float64Array;readonly objective:Uint8Array;readonly anchors:Uint8Array;
 readonly regionIndexByOrdinal:Uint32Array;readonly localIndexByOrdinal:Uint8Array;readonly objectiveWeight:number;
 readonly diagnostics:{compileMs:number;typedBytes:number;boxCount:number;contactPairs:number;sourceCells:number;regionCount:number};
 regionForCell(id:number):ScaleRegion|undefined;
}
const axes=['X','Y','Z'] as const;
const positionKey=(x:number,y:number,z:number)=>`${x},${y},${z}`;

/** Greedy boxes cover only occupied unit cubes. Never substitute the bounds. */
export function packScaleBoxes(ordinals:Iterable<number>,fixture:Pick<ScaleFixture,'x'|'y'|'z'>):ScaleBox[]{
 const points=new Map<string,Point>();
 for(const i of ordinals)points.set(positionKey(fixture.x[i],fixture.y[i],fixture.z[i]),{x:fixture.x[i],y:fixture.y[i],z:fixture.z[i]});
 const order=[...points.values()].sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x),boxes:ScaleBox[]=[];
 for(const p of order){
  if(!points.has(positionKey(p.x,p.y,p.z)))continue;
  let nx=1,nz=1,ny=1;
  while(points.has(positionKey(p.x+nx,p.y,p.z)))nx++;
  outerZ:for(;;nz++){for(let dx=0;dx<nx;dx++)if(!points.has(positionKey(p.x+dx,p.y,p.z+nz)))break outerZ;}
  outerY:for(;;ny++){for(let dz=0;dz<nz;dz++)for(let dx=0;dx<nx;dx++)if(!points.has(positionKey(p.x+dx,p.y+ny,p.z+dz)))break outerY;}
  for(let dy=0;dy<ny;dy++)for(let dz=0;dz<nz;dz++)for(let dx=0;dx<nx;dx++)points.delete(positionKey(p.x+dx,p.y+dy,p.z+dz));
  boxes.push({center:{x:p.x+(nx-1)/2,y:p.y+(ny-1)/2,z:p.z+(nz-1)/2},halfExtents:{x:nx/2,y:ny/2,z:nz/2}});
 }
 return boxes;
}

/** One fixed regional graph over the real compact inventory, not a smaller city.
 * Regional HP is approximate; original occupied cells remain exact geometry. */
export function compileScaleFixture(input:CompactFixture|SceneFixture):ScaleFixture {
 const start=performance.now(),source='idAtOrdinal'in input?input:createDenseFixture(input),n=source.count;
 const x=new Int32Array(n),y=new Int32Array(n),z=new Int32Array(n),cellIds=new Float64Array(n),initialHp=new Float64Array(n),maxHp=new Float64Array(n),objective=new Uint8Array(n),anchors=new Uint8Array(n),regionIndexByOrdinal=new Uint32Array(n),localIndexByOrdinal=new Uint8Array(n);
 const groups=new Map<string,number[]>(),idOrdinals=new Map<number,number>(),positions=new Map<number,number>(),bounds={...source.bounds};
 const widthY=bounds.maxY-bounds.minY+3,widthZ=bounds.maxZ-bounds.minZ+3;
 const key=(px:number,py:number,pz:number)=>((px-bounds.minX+1)*widthY+py-bounds.minY+1)*widthZ+pz-bounds.minZ+1;
 let terrainMinY=Infinity,terrainMinX=Infinity,terrainMaxX=-Infinity,terrainMinZ=Infinity,terrainMaxZ=-Infinity,objectiveWeight=0;
 const buildings=new Set<string>();let hash=2166136261;
 for(let i=0;i<n;i++){
  const id=source.idAtOrdinal(i)!,px=source.xOf(id),py=source.yOf(id),pz=source.zOf(id);
  if(![px,py,pz].every(Number.isSafeInteger))throw new Error('Scale fixture requires integer occupied lattice cells');
  x[i]=px;y[i]=py;z[i]=pz;cellIds[i]=id;initialHp[i]=source.hpOf(id);maxHp[i]=source.maxHpOf(id);objective[i]=Number(source.objectiveOf(id));idOrdinals.set(id,i);
  const k=key(px,py,pz);if(positions.has(k))throw new Error('Scale fixture has overlapping occupied cells');positions.set(k,i);
  const role=source.roleOf(id)!,material=source.materialOf(id)!,objectId=source.objectIdOf(id)!;
  const groupKey=JSON.stringify([role,material,objectId,objective[i],Math.floor(px/4),Math.floor(py/(role==='terrain'?2:4)),Math.floor(pz/4)]);
  const group=groups.get(groupKey);if(group)group.push(i);else groups.set(groupKey,[i]);
  if(role==='terrain'){terrainMinY=Math.min(terrainMinY,py);terrainMinX=Math.min(terrainMinX,px);terrainMaxX=Math.max(terrainMaxX,px);terrainMinZ=Math.min(terrainMinZ,pz);terrainMaxZ=Math.max(terrainMaxZ,pz);}
  if(role==='building'||role==='foundation')buildings.add(objectId);
  objectiveWeight+=maxHp[i]*objective[i];
  hash=Math.imul(hash^id,16777619);hash=Math.imul(hash^px^py^pz,16777619);
 }
 for(let i=0;i<n;i++)if(source.roleOf(cellIds[i])==='terrain'&&y[i]===terrainMinY&&(x[i]===terrainMinX||x[i]===terrainMaxX||z[i]===terrainMinZ||z[i]===terrainMaxZ))anchors[i]=1;
 const directions=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
 const regions:ScaleRegion[]=[];
 for(const [groupKey,ordinals] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
  const remaining=new Set(ordinals),ordered=[...ordinals].sort((a,b)=>x[a]-x[b]||y[a]-y[b]||z[a]-z[b]);
  for(const first of ordered){if(!remaining.delete(first))continue;const component=[first];
   for(let cursor=0;cursor<component.length;cursor++){const i=component[cursor];for(const [dx,dy,dz] of directions){const adjacent=positions.get(key(x[i]+dx,y[i]+dy,z[i]+dz));if(adjacent!==undefined&&remaining.delete(adjacent))component.push(adjacent);}}
   component.sort((a,b)=>x[a]-x[b]||y[a]-y[b]||z[a]-z[b]);const index=regions.length,firstId=cellIds[first];
   const b:CompactBounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};let hp=0,max=0,weight=0,cx=0,cy=0,cz=0;
   component.forEach((i,local)=>{regionIndexByOrdinal[i]=index;localIndexByOrdinal[i]=local;hp+=initialHp[i];max+=maxHp[i];weight+=maxHp[i]*objective[i];cx+=x[i];cy+=y[i];cz+=z[i];for(const axis of axes){const value=axis==='X'?x[i]:axis==='Y'?y[i]:z[i];b[`min${axis}`]=Math.min(b[`min${axis}`],value);b[`max${axis}`]=Math.max(b[`max${axis}`],value);}});
   regions.push({id:`region:${groupKey}:${x[first]},${y[first]},${z[first]}`,index,material:source.materialOf(firstId)!,role:source.roleOf(firstId)!,objectId:source.objectIdOf(firstId)!,cellOrdinals:Uint32Array.from(component),boxes:packScaleBoxes(component,{x,y,z}),center:{x:cx/component.length,y:cy/component.length,z:cz/component.length},bounds:b,maxHp:max,initialHp:hp,objectiveWeight:weight,color:source.colorOf(firstId),neighborIndices:[]});
  }
 }
 const edgePairs=new Map<number,number[]>(),regionCount=regions.length;
 for(let i=0;i<n;i++)for(const [dx,dy,dz] of [[1,0,0],[0,1,0],[0,0,1]]){
  const j=positions.get(key(x[i]+dx,y[i]+dy,z[i]+dz));if(j===undefined)continue;let a=regionIndexByOrdinal[i],b=regionIndexByOrdinal[j];if(a===b)continue;
  let first=i,second=j;if(a>b){[a,b]=[b,a];[first,second]=[second,first];}const k=a*regionCount+b,pairs=edgePairs.get(k);if(pairs)pairs.push(first,second);else edgePairs.set(k,[first,second]);
 }
 const contacts:ScaleContact[]=[];let contactPairs=0;
 for(const [k,pairs] of edgePairs){const a=Math.floor(k/regionCount),b=k%regionCount;contacts.push({a,b,pairs:Uint32Array.from(pairs)});(regions[a].neighborIndices as number[]).push(b);(regions[b].neighborIndices as number[]).push(a);contactPairs+=pairs.length/2;}
 for(const r of regions)(r.neighborIndices as number[]).sort((a,b)=>a-b);
 const arrays=[x,y,z,cellIds,initialHp,maxHp,objective,anchors,regionIndexByOrdinal,localIndexByOrdinal];
 for(const r of regions){const descriptor=`${r.id}:${r.initialHp}:${r.maxHp}:${r.objectiveWeight}`;for(let j=0;j<descriptor.length;j++)hash=Math.imul(hash^descriptor.charCodeAt(j),16777619);}
 // Float64 durability bytes distinguish otherwise identical partially damaged recipes.
 for(const column of [initialHp,maxHp])for(const byte of new Uint8Array(column.buffer))hash=Math.imul(hash^byte,16777619);
 return {source,id:source.id,signature:`scale-regional/v1:${source.id}:${n}:${hash>>>0}`,cellCount:n,structureCount:source.structureCount,terrainCount:source.terrainCount,buildingCount:buildings.size,bounds,regions,contacts,cellIds,x,y,z,initialHp,maxHp,objective,anchors,regionIndexByOrdinal,localIndexByOrdinal,objectiveWeight,
  diagnostics:{compileMs:performance.now()-start,typedBytes:arrays.reduce((sum,a)=>sum+a.byteLength,0)+n*4+contactPairs*8,boxCount:regions.reduce((sum,r)=>sum+r.boxes.length,0),contactPairs,sourceCells:n,regionCount},
  regionForCell(id:number){const ordinal=idOrdinals.get(id);return ordinal===undefined?undefined:regions[regionIndexByOrdinal[ordinal]];}};
}

export function createScaleCityFixture():ScaleFixture{return compileScaleFixture(createCompactGameFixture('city'));}
