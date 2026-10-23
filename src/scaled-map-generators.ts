import type {MaterialId,Vec3,Voxel} from './contracts.js';
import nativePack from './generated/voxel-buildings.json';

/** A footprint center in world X/Z. All dimensions already include scale. */
export interface ScaledBuildingPlacement {
 readonly objectId:string;
 readonly modelId:number;
 readonly x:number;
 readonly z:number;
 readonly quarterTurns:0|1|2|3;
 readonly scale:number;
 readonly width:number;
 readonly depth:number;
 readonly height:number;
 readonly blockId:string;
}
export type ScaledMapId='neighborhood'|'city';
export const SCALED_GROUND_Y=-0.5;
interface NativeModel {
 id:number;
 bounds:{min:number[];max:number[]};
 palette:number[];
 boxes:number[][];
 unanchoredNativeCellCount:number;
}
const models=new Map<number,NativeModel>(nativePack.models.map(model=>[model.id,model]));

function placement(map:ScaledMapId,index:number,modelId:number,x:number,z:number,quarterTurns:0|1|2|3,scale:number,blockId:string):ScaledBuildingPlacement {
 const model=models.get(modelId);
 if(!model||model.unanchoredNativeCellCount!==0)throw new Error(`Map requires a fully grounded native building: ${modelId}`);
 const [nx,ny,nz]=model.bounds.max.map((max,axis)=>max-model.bounds.min[axis]+1);
 return Object.freeze({objectId:`${map}:building-${String(index+1).padStart(2,'0')}`,modelId,x,z,quarterTurns,scale,
  width:(quarterTurns%2?ny:nx)*scale,depth:(quarterTurns%2?nx:ny)*scale,height:nz*scale,blockId});
}

// Nine distinct archived source models surround an empty central square.
// The small source cottages share the eastern lot without overlapping.
const neighborhood=Object.freeze([
 placement('neighborhood',0,1,-34,-27,0,.5,'neighborhood'),
 placement('neighborhood',1,2,0,-27,0,.5,'neighborhood'),
 placement('neighborhood',2,3,34,-27,1,.5,'neighborhood'),
 placement('neighborhood',3,4,-34,0,3,.5,'neighborhood'),
 placement('neighborhood',4,5,-34,27,2,.5,'neighborhood'),
 placement('neighborhood',5,7,0,27,2,.4,'neighborhood'),
 placement('neighborhood',6,6,34,27,1,.3,'neighborhood'),
 placement('neighborhood',7,12,34,-6,1,.5,'neighborhood'),
 placement('neighborhood',8,13,34,6,1,.5,'neighborhood'),
]);

// Three columns by two rows of districts, each containing six actual buildings.
// Model 6 is the 51.5-unit skyline landmark; source cottage heights are 7.5.
const cityModels=[
 [1,2,6,12,13,3],[4,7,5,1,12,2],[6,3,4,13,5,7],
 [2,5,1,12,4,3],[7,6,2,13,1,5],[3,4,7,12,13,6],
] as const;
const cityPlacements:ScaledBuildingPlacement[]=[];
for(let row=0;row<2;row++)for(let column=0;column<3;column++){
 const block=row*3+column,blockId=`city:block-${String(block+1).padStart(2,'0')}`;
 for(let lotRow=0;lotRow<2;lotRow++)for(let lotColumn=0;lotColumn<3;lotColumn++){
  const lot=lotRow*3+lotColumn;
  cityPlacements.push(placement('city',cityPlacements.length,cityModels[block][lot],
   (column-1)*76+(lotColumn-1)*24,(row===0?-48:48)+(lotRow===0?-20:20),
   ((block+lot)%4) as 0|1|2|3,.5,blockId));
 }
}
const city=Object.freeze(cityPlacements);

/** Shared with ground decoration, camera fitting and real browser QA. */
export function getScaledBuildingPlacements(mapId:ScaledMapId):readonly ScaledBuildingPlacement[]{
 return mapId==='neighborhood'?neighborhood:city;
}

function rotate(x:number,z:number,turns:0|1|2|3):[number,number]{
 switch(turns){case 1:return [-z,x];case 2:return [-x,-z];case 3:return [z,-x];default:return [x,z];}
}
function materialFor(modelId:number,color:number,nativeZ:number):MaterialId{
 const r=color>>16,g=(color>>8)&255,b=color&255;
 if(r>g*1.3&&r>b*1.3)return 'roof';
 if(b>r*1.2&&g>r*1.2)return 'glass';
 // Preserve the author's green color, but treat ground plinths as supports,
 // not trees. Above-ground plants remain weak foliage.
 if(g>r*1.2&&g>b*1.2)return nativeZ===0?'stone':'foliage';
 if(Math.max(r,g,b)<=190)return 'glass';
 return modelId>=12?'wood':'stone';
}
const health:Record<MaterialId,number>={wood:2,stone:5,roof:2.4,glass:.6,metal:6,foliage:.8};

function generate(mapId:ScaledMapId,firstId:number):readonly Voxel[]{
 const result:Voxel[]=[];
 for(const p of getScaledBuildingPlacements(mapId)){
  const model=models.get(p.modelId)!;
  const centerX=(model.bounds.min[0]+model.bounds.max[0]+1)/2;
  const centerZ=(model.bounds.min[1]+model.bounds.max[1]+1)/2;
  for(const [x,y,z,dx,dy,dz,paletteIndex] of model.boxes){
   const [worldX,worldZ]=rotate((x+dx/2-centerX)*p.scale,(y+dy/2-centerZ)*p.scale,p.quarterTurns);
   const position:Vec3=Object.freeze({x:p.x+worldX,y:(z+dz/2)*p.scale+SCALED_GROUND_Y,z:p.z+worldZ});
   const size:Vec3=Object.freeze({x:(p.quarterTurns%2?dy:dx)*p.scale,y:dz*p.scale,z:(p.quarterTurns%2?dx:dy)*p.scale});
   const color=model.palette[paletteIndex],material=materialFor(p.modelId,color,z),hp=health[material];
   result.push(Object.freeze({id:firstId+result.length,position,size,color,material,hp,maxHp:hp,
    // Weight is the exact count of original occupied cells, independent of
    // merging and placement scale. It is not the number of render instances.
    weight:dx*dy*dz,anchored:z===0,group:'house',objectId:p.objectId}));
  }
 }
 return Object.freeze(result);
}
const neighborhoodCanonical=generate('neighborhood',1000000);
const cityCanonical=generate('city',2000000);
/** Stable immutable array identity allows canonical spatial/support caches. */
export function neighborhoodVoxels():readonly Voxel[]{return neighborhoodCanonical;}
export function cityVoxels():readonly Voxel[]{return cityCanonical;}
