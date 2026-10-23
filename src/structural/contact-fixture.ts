import type {Cell,SceneFixture} from './types.js';
/** Small, explicitly diagnostic fixture. Not a substitute for the warm maps.
 * Every root is a bottom-boundary soil cell. A narrow soil bridge supports
 * three connected building cells above a separate receiving foundation. */
export function createContactFixture():SceneFixture{
 const cells:Cell[]=[];let next=100;
 const put=(id:number,x:number,y:number,z:number,role:Cell['role'],hp:number,anchor=false)=>cells.push({id,objectId:role==='building'?'falling-beam':role==='foundation'?'receiver':'soil',role,position:{x,y,z},material:role==='building'?'wood':role==='foundation'?'stone':'soil',color:role==='building'?0xae7545:role==='foundation'?0x778080:0x8b6240,hp,maxHp:hp,anchor});
 for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)put(next++,x,-4,z,'terrain',1000,Math.abs(x)===4||Math.abs(z)===4);
 for(let y=-3;y<=0;y++)put(next++,-2,y,0,'terrain',1000);
 put(next++,-1,0,0,'terrain',1000);put(1,0,0,0,'terrain',1);
 put(2,0,1,0,'building',200);put(3,0,2,0,'building',200);put(4,0,3,0,'building',200);
 put(11,0,-3,0,'foundation',30);
 return{id:'contact-calibration',cells};
}
