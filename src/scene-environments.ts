import * as THREE from 'three';
import type { MapId } from './contracts';
import { WORLD_BOUNDS } from './world-layout';
import { getScaledBuildingPlacements } from './scaled-map-generators';

export type EnvironmentBlock={x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number;role:string};
export type EnvironmentSpec={
 mapId:MapId;bounds:{halfX:number;halfZ:number};blocks:EnvironmentBlock[];water:EnvironmentBlock[];
 sky:number;fog:[number,number];shadowExtent:number;
 camera:{position:[number,number,number];target:[number,number,number];near:number;far:number;minDistance:number;maxDistance:number};
};
const oldCamera={position:[27,23,32] as [number,number,number],target:[0,4.5,0] as [number,number,number],near:.2,far:250,minDistance:19,maxDistance:72};
const cameras:Record<MapId,EnvironmentSpec['camera']>={
 courtyard:oldCamera,
 warehouse:{...oldCamera,position:[29,25,34]},
 bridge:{...oldCamera,position:[31,25,35],target:[0,4,0]},
 tower:{...oldCamera,position:[30,29,36],target:[0,7,0]},
 cantilever:{...oldCamera,position:[31,27,36],target:[0,5.5,0]},
 neighborhood:{position:[110,90,125],target:[0,12,0],near:.4,far:650,minDistance:24,maxDistance:280},
 city:{position:[250,205,285],target:[0,18,0],near:.8,far:1600,minDistance:45,maxDistance:680},
};

/** Bounded scenic context only. All destructible buildings come from the world. */
export function getEnvironmentSpec(mapId:MapId,options:{authoritative?:boolean}={}):EnvironmentSpec {
 const blocks:EnvironmentBlock[]=[],water:EnvironmentBlock[]=[];
 const add=(role:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number)=>blocks.push({role,x,y,z,sx,sy,sz,color});
 const wet=(x:number,y:number,z:number,sx:number,sz:number,color=0x4a9fb5)=>water.push({role:'water',x,y,z,sx,sy:.18,sz,color});
 let seed=18717+(['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city'].indexOf(mapId))*8191;
 const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const palette=(colors:number[])=>colors[Math.floor(rand()*colors.length)];
 const tree=(x:number,z:number,s=1,y=0)=>{
  add('tree',x,y+1.25*s,z,.48*s,2.5*s,.48*s,0x765334);
  add('tree',x,y+3.1*s,z,2.4*s,2.3*s,2.2*s,palette([0x547638,0x668b41,0x76994c]));
  add('tree',x+.2*s,y+4.4*s,z,1.7*s,.9*s,1.6*s,0x85a84e);
 };
 const lamp=(x:number,z:number,s=1)=>{
  add('lamp',x,1.9*s,z,.14*s,3.8*s,.14*s,0x343e42);
  add('lamp',x,3.85*s,z,.48*s,.45*s,.48*s,0xf2d591);
  add('lamp',x,4.12*s,z,.6*s,.12*s,.6*s,0x36424b);
 };
 const road=(x:number,z:number,sx:number,sz:number,mark=true)=>{
  add('road',x,-.12,z,sx,.22,sz,0x5d6468);
  if(mark){if(sx>sz){for(let a=x-sx/2+2;a<x+sx/2-1;a+=5)add('road-marking',a,.007,z,2,.014,.12,0xe4dbb8);}else{for(let a=z-sz/2+2;a<z+sz/2-1;a+=5)add('road-marking',x,.007,a,.12,.014,2,0xe4dbb8);}}
 };
 const curb=(x:number,z:number,sx:number,sz:number)=>add('curb',x,-.02,z,sx,.18,sz,0xc9c4b1);
 const ground=(sx:number,sz:number,top:number,side:number)=>{add('ground',0,-1.25,0,sx,2.2,sz,side);add('ground',0,-.35,0,sx,.38,sz,top);};
 const hills=(span:number,z:number,height:number)=>{
  for(let i=0;i<25;i++){const x=-span/2+i*span/24,h=height*(.5+rand());add('hill',x,h/2-2,z-rand()*span*.12,span/18,h,span/9,palette([0x7b9686,0x88a392,0x6d8e81]));add('hill',x,h-1,z-rand()*2,span/18,1.5,span/9,0x8aa472);}
 };
 // Decorative land never changes WORLD_BOUNDS, physics, scoring or target geometry.
 const scenicTerrain=(minX:number,maxX:number,minZ:number,maxZ:number)=>add('scenic-terrain',(minX+maxX)/2,-8,(minZ+maxZ)/2,maxX-minX,16,maxZ-minZ,0x819378);
 const rootedHills=(span:number,z:number,height:number)=>{
  // Overlapping ridges share one visible foundation. Caps stay over their own column.
  const width=span/21,depth=span/5;
  for(let i=0;i<25;i++){
   const x=-span/2+i*span/24,centerZ=z+Math.sin(i*.45)*span*.02,h=height*(.48+.18*Math.sin(i*.62)+rand()*.12);
   add('hill',x,h*.15,centerZ+depth*.28,width, h*.3,depth*.7,0x7c9775);
   add('hill',x,h/2,centerZ,width,h,depth,palette([0x7b9686,0x88a392,0x6d8e81]));
   add('hill',x,h+.3,centerZ,width-.15,.6,depth-.15,0x8aa472);
  }
 };
 const clouds=(span:number,z:number,y:number)=>{for(let i=0;i<8;i++){const x=(rand()-.5)*span;add('cloud',x,y+rand()*15,z-rand()*span*.16,10+rand()*16,2,5,0xe5eeee);add('cloud',x+1,y+2+rand()*15,z-rand()*span*.16,7+rand()*9,2,5,0xf4f5e9);}};
 if(mapId==='courtyard'){
  // Original 53×43 meadow and original random seed, camera and colors are retained.
  ground(53,43,0x819548,0x726a44);
  for(let x=-26;x<27;x+=2)for(let z=-21;z<22;z+=2)add('grass',x,-.12+rand()*.08,z,2,.15,2,palette([0x849c4b,0x8da654,0x91a557,0x7e994b,0x98aa57]));
  for(let z=7;z<22;z+=1.5)for(let j=0;j<3;j++)add('path',(j-1)*1.35+Math.sin(z*.3)*.6,.07,z,1.18,.17,1.25,palette([0xb7af8f,0xc5bda0,0xa8a88c]));
  for(let i=0;i<1250;i++){const x=(rand()-.5)*50,z=(rand()-.5)*40;if(Math.abs(x)<9&&z>-7&&z<8||Math.abs(x)<2.8&&z>5)continue;const h=.15+rand()*.4;add('grass',x,h/2+.05,z,.11,h,.15,palette([0x6d8636,0x78943e,0x9eaf54]));if(rand()<.2)add('flower',x,h+.07,z,.22,.17,.22,palette([0xeec85b,0xf1e4b0,0xc6d6a8,0xdac365]));}
  wet(0,-1.3,-64,160,100);
  for(let i=0;i<130;i++)add('ripple',(rand()-.5)*145,-1.17,-23-rand()*75,1+rand()*5,.035,.09+rand()*.14,palette([0x94ccd2,0x74bdc9,0xadd5d6]));
  for(let i=0;i<31;i++){const x=-80+i*5.5,z=-56-rand()*23,h=5+rand()*15;add('hill',x,h/2-1.5,z,6+rand()*5,h,12,palette([0x809c96,0x94aaa1,0x6f9290,0xa2b3a4]));add('hill',x,h-.9,z,6.3,1.2,12.3,palette([0x87a76f,0x9bb782,0x7e9f74]));if(i%3===0)add('hill',x,h+1,z,2,3,2,0x769a70);}
  for(let i=0;i<18;i++){const x=-70+i*8,h=10+rand()*20;add('hill',x,h/2-1,-95,10,h,12,palette([0x91b0b4,0xa2bfc1,0x83a6ad]));}
  for(let i=0;i<10;i++){const x=-90+rand()*180,y=32+rand()*20,z=-65-rand()*40;add('cloud',x,y,z,8+rand()*13,1.8,3.5,0xe4eeee);add('cloud',x+1,y+1.5,z,5+rand()*5,2,3,0xf4f5e9);}
 }else if(mapId==='warehouse'){
  ground(53,43,0x858982,0x5f635d);
  for(let x=-25;x<26;x+=4)for(let z=-20;z<21;z+=4)add('paving',x,-.13,z,3.94,.12,3.94,palette([0x999a8e,0x93958b,0xa1a194]));
  road(0,16,53,7);road(-23,0,6,43,false);
  for(const x of [-15,-9,9,15]){add('loading-bay',x,.015,10,5,.025,.16,0xe9c75d);add('loading-bay',x-2.4,.015,7,.16,.025,6,0xe9c75d);}
  // Decorative freight perimeter remains outside the old authoritative yard.
  for(let i=0;i<9;i++){const x=-31+i*7;add('container',x,1.1,-31,6,2.4,3,palette([0x5e8290,0xb96843,0x8f9c6b]));for(let j=0;j<6;j++)add('container',x-2.5+j,1.1,-29.45,.10,2.2,.08,0x3d5b64);}
  for(const x of [-32,34]){add('crane',x,9,-42,.8,18,.8,0xc69b4b);add('crane',x+4,17,-42,15,.7,.8,0xc69b4b);add('crane',x+10,12,-42,.12,10,.12,0x586064);}
  hills(160,-75,10);clouds(160,-85,40);
 }else if(mapId==='bridge'){
  ground(53,43,0x829078,0x626d65);
  wet(0,-.45,0,32,44,0x478b9f);
  for(const x of [-22,22]){add('embankment',x,-.15,0,10,.5,43,0x9aa092);road(x,0,5,43);curb(x+(x<0?3:-3),0,.7,43);}
  for(let z=-19;z<=19;z+=5){add('ripple',Math.sin(z)*6,-.33,z,8,.025,.15,0x8bc5d0);for(const x of [-17,17])add('bank',x,-.5,z,2,1.4,4.7,0x747f79);}
  wet(0,-.45,-58,40,76,0x478b9f);hills(160,-95,12);clouds(160,-90,44);
 }else if(mapId==='tower'){
  ground(53,43,0xb2b1a4,0x747b79);
  for(let x=-24;x<26;x+=3)for(let z=-19;z<21;z+=3)add('plaza',x,-.11,z,2.94,.16,2.94,palette([0xc1c0b1,0xb9bcaf,0xc8c6b6]));
  for(const x of [-23,23])road(x,0,5,43);
  for(const z of [-19,19])road(0,z,42,4);
  for(const x of [-16,16])for(const z of [-14,14]){add('planter',x,.3,z,3,.6,3,0x8a9186);tree(x,z,.9,.6);lamp(x+(x<0?2:-2),z,1);}
  for(let i=0;i<13;i++){const x=-39+i*6;add('median',x,0,-33,4,.5,5,0x84955d);tree(x,-33,1.2);}
  hills(180,-90,12);clouds(150,-85,46);
 }else if(mapId==='cantilever'){
  ground(53,43,0x9a9b7c,0x877e66);
  // The inherited yard stays authoritative on its terrace; cliff/ocean starts beyond it.
  for(let z=-20;z<22;z+=3){add('cliff',27,-6,z,3.5,12,3.4,palette([0x7f7864,0x9a9077,0x6e7264]));add('cliff',30,-10,z,5,9,3.5,0x78806e);}
  for(let x=-25;x<=25;x+=3)add('cliff',x,-5,-22,3.5,10,3.5,palette([0x858470,0x98907c]));
  wet(77,-10,0,110,180,0x438ba5);wet(0,-10,-78,210,100,0x438ba5);
  for(let i=0;i<55;i++)add('ripple',36+rand()*60,-9.87,(rand()-.5)*115,3+rand()*7,.03,.15,0x8fbec2);
  road(-20,0,5,43);for(let z=-18;z<20;z+=6)tree(-25,z,.8);
  hills(180,-120,15);clouds(180,-100,45);
 }else if(mapId==='neighborhood'){
  ground(100,80,0x8c9e6e,0x74816a);
  scenicTerrain(-150,150,-165,-40);scenicTerrain(-150,-50,-40,40);
  scenicTerrain(50,150,-40,40);scenicTerrain(-150,150,40,65);
  // A legible street network exactly between the nine source-asset footprints.
  for(const x of [-17,17]){road(x,0,7,80);for(const side of [-1,1])curb(x+side*4.15,0,1.1,80);}
  for(const z of [-13.5,13.5]){road(0,z,100,6);for(const side of [-1,1])curb(0,z+side*3.55,100,1.1);}
  for(const x of [-47,47])road(x,0,5.5,80);for(const z of [-38,38])road(0,z,94,4);
  // Individual paved lots, not decorative duplicate buildings.
  for(const p of getScaledBuildingPlacements('neighborhood'))add('lot',p.x,-.23,p.z,p.width+1,.20,p.depth+1,0xc4c1ac);
  add('plaza',0,-.08,0,20,.2,20,0xc5c6b5);
  for(let x=-9;x<10;x+=2)for(let z=-9;z<10;z+=2)add('plaza',x,.025,z,1.94,.03,1.94,palette([0xd0cdb8,0xc8cab9,0xbdbfae]));
  for(const x of [-7,7])for(const z of [-7,7]){add('planter',x,.22,z,2,.45,2,0x9b9c80);tree(x,z,.9,.45);}
  for(const z of [-5,5]){add('bench',0,.7,z,3,.25,.65,0x9a7048);for(const x of [-1,1])add('bench',x,.3,z,.15,.6,.5,0x535d5d);}
  for(const x of [-21.5,21.5])for(const z of [-34,-24,-5,5,24,34]){tree(x,z,.85);lamp(x+(x<0?1.9:-1.9),z,1);}
  for(const z of [-13.5,13.5])for(const x of [-17,17])for(let stripe=-2;stripe<=2;stripe++)add('crosswalk',x+stripe*.7,.035,z+4.3,.38,.025,1.6,0xf1ecda);
  for(let i=0;i<30;i++)tree(-61+i*4.2,-49-rand()*9,.9+rand()*.5);
  rootedHills(250,-95,24);clouds(250,-125,70);
 }else{
  ground(240,200,0x8c9e77,0x75816c);
  // Join the port and northern tree row to the city while preserving the river cutout.
  scenicTerrain(-320,320,-340,-130);scenicTerrain(-320,124,-130,-100);
  scenicTerrain(-320,-120,-100,100);scenicTerrain(120,124,-100,100);
  scenicTerrain(-320,124,100,150);scenicTerrain(168,320,-130,150);
  add('river-bed',146,-8.1,0,44,13.8,260,0x687e79);
  // Six real asset blocks. Outer roads + two avenues + central boulevard remain open.
  for(const x of [-38,38]){road(x,0,8,200);for(const side of [-1,1])curb(x+side*4.5,0,.9,200);}
  road(0,0,240,16);for(const z of [-9.2,9.2])curb(0,z,240,1.4);
  for(const x of [-116,116])road(x,0,7,200);for(const z of [-94,94])road(0,z,232,9);
  for(const cx of [-76,0,76])for(const cz of [-48,48]){
   add('district-paving',cx,-.22,cz,69,.2,77,0xbabca9);
   road(cx,cz,67,6);for(const z of [cz-3.6,cz+3.6])curb(cx,z,67,.8);
   for(const x of [cx-12,cx+12])road(x,cz,4,76,false);
   for(const x of [cx-32,cx+32])for(const z of [cz-34,cz+34])tree(x,z,1.3);
   for(const x of [cx-28,cx,cx+28]){lamp(x,cz-5,1.5);lamp(x,cz+5,1.5);}
  }
  for(const x of [-38,38])for(const z of [-48,48])for(let stripe=-3;stripe<=3;stripe++)add('crosswalk',x+stripe,.04,z+5,.6,.03,2.5,0xece7d3);
  // River and two bridges are scenic context outside playable building bounds.
  wet(146,-1.2,0,42,260,0x378da9);
  for(const x of [123,169]){add('embankment',x,-.1,0,3,2,240,0x9fa79b);for(let z=-110;z<=110;z+=12)tree(x+(x>150?4:-3),z,1.3);}
  for(const z of [-48,48]){
   add('bridge',146,1,z,51,1,8,0xbcb9a8);add('bridge-road',146,1.56,z,51,.12,6,0x626b70);
   for(const x of [134,157])add('bridge',x,-1,z,2,6,5,0x8b9491);
   for(const edge of [-1,1])add('bridge',146,2.15,z+edge*3.8,51,.65,.3,0xb5b9ad);
   for(let x=125;x<172;x+=7)add('road-marking',x,1.65,z,3,.025,.16,0xe9ddaa);
  }
  // A bounded port backdrop, with cranes and containers, no fake scored towers.
  for(let i=0;i<16;i++){const x=-116+i*5.5,z=-119-(i%3)*5;add('container',x,1.5,z,5,3,3.5,palette([0xb87743,0x4d7f90,0x9d624c,0x799268]));}
  for(const x of [-96,-65]){add('crane',x,10,-140,1.2,20,1.2,0xc29d59);add('crane',x+8,19,-140,24,1,1.2,0xc29d59);add('crane',x+17,13,-140,.2,12,.2,0x5f6b69);}
  for(let i=0;i<50;i++)tree(-140+i*6,-164-rand()*20,1.3+rand());
  rootedHills(570,-230,48);clouds(500,-275,105);
 }
 const large=mapId==='city',medium=mapId==='neighborhood';
 return {mapId,bounds:{...WORLD_BOUNDS[mapId]},blocks:options.authoritative?outsideAuthority(blocks,WORLD_BOUNDS[mapId]):blocks,water:options.authoritative?outsideAuthority(water,WORLD_BOUNDS[mapId]):water,sky:mapId==='warehouse'?0xb8c7cb:mapId==='cantilever'?0xadcfdc:0xadcbd9,fog:large?[420,1000]:medium?[210,520]:[70,165],shadowExtent:large?160:medium?72:33,camera:{...cameras[mapId],position:[...cameras[mapId].position],target:[...cameras[mapId].target]}};
}

/** Clip scenic cuboids around the authoritative rectangle, never over its holes. */
function outsideAuthority(blocks:EnvironmentBlock[],bounds:{halfX:number;halfZ:number}):EnvironmentBlock[]{
 const result:EnvironmentBlock[]=[];
 for(const block of blocks){
  const x0=block.x-block.sx/2,x1=block.x+block.sx/2,z0=block.z-block.sz/2,z1=block.z+block.sz/2;
  if(x1<=-bounds.halfX||x0>=bounds.halfX||z1<=-bounds.halfZ||z0>=bounds.halfZ){result.push(block);continue;}
  const add=(a:number,b:number,c:number,d:number)=>{if(b-a>1e-6&&d-c>1e-6)result.push({...block,x:(a+b)/2,z:(c+d)/2,sx:b-a,sz:d-c});};
  // Disjoint strips preserve the continuous scenic terrain outside the map.
  add(x0,Math.min(x1,-bounds.halfX),z0,z1);add(Math.max(x0,bounds.halfX),x1,z0,z1);
  const a=Math.max(x0,-bounds.halfX),b=Math.min(x1,bounds.halfX);
  add(a,b,z0,Math.min(z1,-bounds.halfZ));add(a,b,Math.max(z0,bounds.halfZ),z1);
 }
 return result;
}

/** All materials and instance buffers belong to this environment, never the shared cube. */
export function createEnvironmentRenderer(scene:THREE.Scene,sharedBox:THREE.BufferGeometry,mapId:MapId,options:{authoritative?:boolean}={}){
 const spec=getEnvironmentSpec(mapId,options),object=new THREE.Group();object.name=`environment-${mapId}`;
 const material=new THREE.MeshStandardMaterial({roughness:1,metalness:0});
 const mesh=new THREE.InstancedMesh(sharedBox,material,spec.blocks.length),transform=new THREE.Object3D(),color=new THREE.Color();
 spec.blocks.forEach((b,i)=>{transform.position.set(b.x,b.y,b.z);transform.scale.set(b.sx,b.sy,b.sz);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);mesh.setColorAt(i,color.setHex(b.color));});
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();object.add(mesh);
 const waterMaterial=new THREE.MeshStandardMaterial({roughness:.28,metalness:.22});
 const water=new THREE.InstancedMesh(sharedBox,waterMaterial,Math.max(1,spec.water.length));water.count=spec.water.length;
 spec.water.forEach((b,i)=>{transform.position.set(b.x,b.y,b.z);transform.scale.set(b.sx,b.sy,b.sz);transform.updateMatrix();water.setMatrixAt(i,transform.matrix);water.setColorAt(i,color.setHex(b.color));});
 water.receiveShadow=true;water.computeBoundingSphere();object.add(water);scene.add(object);let disposed=false;
 return {object,spec,dispose(){if(disposed)return;disposed=true;object.removeFromParent();mesh.dispose();water.dispose();material.dispose();waterMaterial.dispose();}};
}
