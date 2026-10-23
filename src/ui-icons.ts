import {createWorld} from './domain';
import type {MapId} from './contracts';
import {MAPS} from './content-catalog';
const cache=new Map<MapId,string>();
/** Isometric projection of the actual map voxels, not an illustrative mockup. */
export function scenePreview(map:MapId):string{
 const cached=cache.get(map);if(cached)return cached;
 const model=createWorld();model.loadMap(map,true);
 const voxels=[...model.getVoxels()].sort((a,b)=>(a.position.x+a.position.z-b.position.x-b.position.z)||a.position.y-b.position.y);
 const project=(x:number,y:number,z:number)=>[(x-z)*.866,(x+z)*.5-y];
 const points=voxels.flatMap(v=>{const {x,y,z}=v.position;return [project(x-.5,y-.5,z-.5),project(x+.5,y+.5,z+.5),project(x-.5,y+.5,z+.5),project(x+.5,y-.5,z-.5)];});
 const minX=Math.min(...points.map(p=>p[0]))-2,maxX=Math.max(...points.map(p=>p[0]))+2,minY=Math.min(...points.map(p=>p[1]))-2,maxY=Math.max(...points.map(p=>p[1]))+2;
 const faces=voxels.map(v=>{const{x,y,z}=v.position,c='#'+v.color.toString(16).padStart(6,'0');const p=(dx:number,dy:number,dz:number)=>project(x+dx,y+dy,z+dz).map(n=>n.toFixed(2)).join(',');return `<g fill="${c}"><polygon points="${p(-.5,.5,-.5)} ${p(.5,.5,-.5)} ${p(.5,.5,.5)} ${p(-.5,.5,.5)}"/><polygon points="${p(.5,.5,-.5)} ${p(.5,-.5,-.5)} ${p(.5,-.5,.5)} ${p(.5,.5,.5)}"/><polygon points="${p(-.5,.5,.5)} ${p(.5,.5,.5)} ${p(.5,-.5,.5)} ${p(-.5,-.5,.5)}"/><polygon fill="#000" opacity=".2" points="${p(.5,.5,-.5)} ${p(.5,-.5,-.5)} ${p(.5,-.5,.5)} ${p(.5,.5,.5)}"/></g>`;}).join('');
 const svg=`<svg viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}" role="img" aria-label="${MAPS[map].name}的真实体素结构预览">${faces}</svg>`;cache.set(map,svg);return svg;
}
