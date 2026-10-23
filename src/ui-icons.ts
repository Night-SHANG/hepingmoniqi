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

/** Hand-authored filled, faceted inventory art. Separate from the real-world preview. */
export const toolArtwork={
 charge:'<path d="m10 3 11 1 3 6-5 3-9-3z" fill="#a8b6b7"/><path d="m21 4 5 3 2 10-3 1-3-10z" fill="#566a73"/><path d="m8 11 12-2 7 7-2 11-12 4-9-7z" fill="#536e31"/><path d="m8 11 12-2 7 7-13 3z" fill="#9dac55"/><path d="m14 19 13-3-2 11-12 4z" fill="#354d26"/><path d="m5 18 9 4 12-4v4l-12 4-9-4z" fill="#dbbb4d"/><path d="m8 12 3 1-1 7-3-1zm6 1 3-1v7l-3 1zm6-1 3 2-1 4-3 1z" fill="#bbc278"/>',
 pulse:'<path d="m20 3 8-1-1 9-6 1z" fill="#ff8a37"/><path d="m20 3 8-1-5 6z" fill="#ffc176"/><path d="m20 8 5 5-12 13-6-6z" fill="#d8e4ed"/><path d="m23 11 2 2-12 13-2-3z" fill="#728d9f"/><path d="m16 12 5 5-4 4-5-5z" fill="#f59132"/><path d="m8 17-6 6 5 1 3-5zm7 7-2 6 6-3 1-7z" fill="#e46a2d"/><path d="m6 23 5 5-4 1-4-4z" fill="#465b70"/><path d="m4 27-3 4 5-2z" fill="#ffd976"/>',
 shock:'<path d="m3 11 19-4 8 6-19 5z" fill="#718495"/><path d="m3 11 8 7v12l-8-6z" fill="#3a4d60"/><path d="m11 18 19-5v12l-19 5z" fill="#263c54"/><path d="m8 10 4-1 8 6-4 1v13l-4 1V18zM20 8l3 1 6 5-3 1v11l-4 1V16z" fill="#a58a60"/><path d="m16 18 7-2v6l-7 2z" fill="#ef8735"/><path d="m17 8 2-1V3l5-1v2l-3 1v4z" fill="#9cafbb"/><path d="m22 1 4-1v4l-4 1z" fill="#ffad45"/>',
 echo:'<path d="m15 6 4 2 8 17-12 5-12-6z" fill="#314c64"/><path d="m15 6 4 2-7 16-9 0z" fill="#7393aa"/><path d="m12 24 15 1-12 5z" fill="#182c43"/>'+[[16,7],[7,24],[25,24]].map(([x,y])=>`<g transform="translate(${x} ${y})"><path d="m-6-3 4-3 6 1 3 4-1 5-4 3-6-2-3-4z" fill="#1a506a"/><path d="m-6-3 4-3 6 1-3 2-5-1z" fill="#a0daea"/><path d="m4-5 3 4-1 5-3 2V0z" fill="#456882"/><path d="m-5-2 3-2 4 1 2 3-1 4-3 2-4-2-2-3z" fill="#117391" stroke="#6feaff" stroke-width="1.2"/><circle r="2.6" fill="#12374d" stroke="#94f5ff" stroke-width="1"/><path d="m-2-2 2-1 2 1-2 1z" fill="#d6ffff"/></g>`).join(''),
 split:'<path d="m9 8 10-2 9 9-2 11-10 5-12-8-1-9z" fill="#0867b1"/><path d="m9 8 10-2 3 7-10 3-9-2z" fill="#51caff"/><path d="m12 16 10-3 6 2-2 11-10 5z" fill="#084b91"/><path d="m12 16 4 15-12-8-1-9z" fill="#188bd3"/><path d="m7 10 5 1-1 4-5-1zm7-1 5-1 2 4-6 1zm1 8 5-2 1 5-5 2zm7 4 4-2-1 5-3 2z" fill="#70d4ff"/>'+[[16,4],[5,24],[27,23]].map(([x,y])=>`<g transform="translate(${x} ${y})"><path d="m-4-3 5-2 3 3-5 2z" fill="#ffcf72"/><path d="m-4-3 3 3v5l-3-3z" fill="#e47b26"/><path d="m-1 0 5-2v5l-5 2z" fill="#ffa23b"/></g>`).join(''),
};
export function backpackIcon(locked=false):string{
 const c=locked?['#7b99b8','#405c7b','#273f5d','#adc3d9','#20354d']:['#edbc69','#ab7137','#704324','#ffe0a0','#5d3c26'];
 return `<svg viewBox="0 0 64 72" aria-hidden="true"><path d="M23 15V9l7-4 12 2 4 6v7l-6-1v-6l-9-2-2 2v5z" fill="${c[3]}"/><path d="m10 23 30-8 14 10-29 9z" fill="${c[0]}"/><path d="m10 23 15 11v34L10 57z" fill="${c[2]}"/><path d="m25 34 29-9v35l-29 8z" fill="${c[1]}"/><path d="m13 22 28-8 10 7-28 9z" fill="${c[0]}" stroke="${c[3]}" stroke-width="1"/><path d="m15 27 5 3v31l-5-4zm22 3 5-2v34l-5 2z" fill="${c[2]}"/><path d="m27 43 24-7v19l-24 7z" fill="${c[0]}"/><path d="m29 46 20-6v3l-20 6z" fill="${c[3]}"/><path d="m33 30 9-3v12l-9 3z" fill="${c[3]}"/><path d="m36 32 3-1v5l-3 1z" fill="${c[4]}"/>${locked?'<path d="M34 50v-4a5 5 0 0 1 10 0v4" fill="none" stroke="#cee4f6" stroke-width="3"/><rect x="32" y="49" width="15" height="12" rx="2" fill="#b5cce1"/><path d="M39 53v5" stroke="#415b79" stroke-width="2"/>':''}</svg>`;
}
