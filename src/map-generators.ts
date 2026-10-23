import type { Voxel } from './contracts.js';

// Same material health, palette and coordinate hash as src/domain.ts.
// Kept isolated until the lead integrates an authoritative shared palette.
const materials = {
 wood: {hp:2, colors:[0x996238,0xae7545,0xc18a53,0xb47a47]},
 stone: {hp:5, colors:[0x626c70,0x778080,0x59666b]},
 roof: {hp:2.4, colors:[0xa94633,0xbc553d,0x923b30]},
 glass: {hp:0.6, colors:[0x8bc7cf,0xa9dfe0]},
 metal: {hp:6, colors:[0x3d4954,0x515e65]},
};
type BuildingMaterial = keyof typeof materials;
function builder(objectId:string, firstId:number) {
 const cells = new Map<string,Voxel>();
 const put = (x:number,y:number,z:number,material:BuildingMaterial) => {
  const spec=materials[material];
  cells.set(`${x},${y},${z}`,{id:0,position:{x,y,z},material,
   color:spec.colors[Math.abs(x*73+y*31+z*17)%spec.colors.length],hp:spec.hp,maxHp:spec.hp,
   anchored:y===0,group:'house',objectId});
 };
 return {put, finish:()=>[...cells.values()].map((voxel,index):Voxel=>Object.freeze({
  ...voxel,id:firstId+index,position:Object.freeze({...voxel.position})
 }))};
}

/** 高架连廊: exposed pier necks and three independent expansion-jointed spans. */
export function bridgeVoxels():Voxel[] {
 const {put,finish}=builder('highbridge',30000);
 for(const [left,right,pier] of [[-10,-4,-7],[-2,3,0],[5,10,7]]) {
  // Broad ground shoes, slender accessible necks, crossheads below each deck.
  for(let x=pier-1;x<=pier+1;x++)for(let z=-1;z<=1;z++)put(x,0,z,'stone');
  for(let y=1;y<=5;y++)put(pier,y,0,'stone');
  for(let z=-2;z<=2;z++)put(pier,5,z,'metal');
  for(let x=left;x<=right;x++)for(let z=-2;z<=2;z++) {
   put(x,6,z,'stone');
   if(Math.abs(z)===2)put(x,7,z,'metal');
  }
 }
 // Empty x=-3 and x=4 expansion joints intentionally prevent lateral support
 // bypass. All spans retain the same building object identity for scoring.
 return finish();
}

/** 叠层塔楼: three stepped floor plates, open lower colonnades, upper core. */
export function towerVoxels():Voxel[] {
 const {put,finish}=builder('layeredtower',40000);
 for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)put(x,0,z,'stone');
 // A grounded lower service core anchors both broad lower floors.
 for(let y=1;y<=9;y++)for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)put(x,y,z,'stone');
 for(const x of [-4,4])for(const z of [-3,3])for(let y=0;y<=9;y++)put(x,y,z,'metal');
 for(const [y,halfX,halfZ] of [[4,6,4],[9,5,4],[14,3,3]]) {
  for(let x=-halfX;x<=halfX;x++)for(let z=-halfZ;z<=halfZ;z++)put(x,y,z,'stone');
 }
 // The top cantilever has one deliberately readable, accessible support neck.
 for(let y=10;y<=13;y++)put(0,y,0,'metal');
 // Open top-story window frames; no solid cottage walls or pitched roof.
 for(const x of [-3,3])for(const z of [-3,3])for(let y=15;y<=18;y++)put(x,y,z,'metal');
 for(let x=-3;x<=3;x++)for(const z of [-3,3])put(x,18,z,'metal');
 for(let z=-3;z<=3;z++)for(const x of [-3,3])put(x,18,z,'metal');
 // Low rails remain attached to their floor, leaving the window apertures open.
 for(let x=-3;x<=3;x++)for(const z of [-3,3])put(x,15,z,'glass');
 return finish();
}
