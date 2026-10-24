// Isolated proof only. No production renderer/authority mutation.
type Cell={position:{x:number;y:number;z:number};color:number};type Bounds={halfX:number;halfZ:number;depth:number};
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const corners=[[[1,0,0],[1,1,0],[1,0,1],[1,1,1]],[[0,0,1],[0,1,1],[0,0,0],[0,1,0]],[[0,1,1],[1,1,1],[0,1,0],[1,1,0]],[[0,0,0],[1,0,0],[0,0,1],[1,0,1]],[[1,0,1],[1,1,1],[0,0,1],[0,1,1]],[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]];
export function buildSurface(b:Bounds,cells:Cell[],soilColor:(x:number,y:number,z:number)=>number,collectFaces=true){
 const key=(x:number,y:number,z:number)=>`${x},${y},${z}`,occupied=new Map(cells.map(c=>[key(c.position.x,c.position.y,c.position.z),c]));
 const soil=(x:number,y:number,z:number)=>x>=-b.halfX&&x<=b.halfX&&z>=-b.halfZ&&z<=b.halfZ&&y<=-1&&y>=-b.depth;
 const solid=(x:number,y:number,z:number)=>soil(x,y,z)||occupied.has(key(x,y,z));
 function visit(emit:(x:number,y:number,z:number,face:number,color:number)=>void){
  for(const c of cells){const {x,y,z}=c.position;for(let f=0;f<6;f++){const [dx,dy,dz]=dirs[f];if(!solid(x+dx,y+dy,z+dz))emit(x,y,z,f,c.color);}}
  // Only surface coordinates are visited, never instantiate eight layers.
  for(let x=-b.halfX;x<=b.halfX;x++)for(let z=-b.halfZ;z<=b.halfZ;z++){
   if(!occupied.has(key(x,0,z)))emit(x,-1,z,2,soilColor(x,-1,z));emit(x,-b.depth,z,3,soilColor(x,-b.depth,z));
  }
  for(let d=1;d<=b.depth;d++){
   for(let z=-b.halfZ;z<=b.halfZ;z++){emit(b.halfX,-d,z,0,soilColor(b.halfX,-d,z));emit(-b.halfX,-d,z,1,soilColor(-b.halfX,-d,z));}
   for(let x=-b.halfX;x<=b.halfX;x++){emit(x,-d,b.halfZ,4,soilColor(x,-d,b.halfZ));emit(x,-d,-b.halfZ,5,soilColor(x,-d,-b.halfZ));}
  }
 }
 let count=0;visit(()=>count++);const positions=new Float32Array(count*18),normals=new Int8Array(count*18),colors=new Uint32Array(count),faces:{x:number;y:number;z:number;face:number;color:number}[]=[];
 let i=0;visit((x,y,z,face,color)=>{if(collectFaces)faces.push({x,y,z,face,color});colors[i]=color;const order=[0,1,2,2,1,3];for(let v=0;v<6;v++){const c=corners[face][order[v]];positions.set([x+c[0]-.5,y+c[1]-.5,z+c[2]-.5],i*18+v*3);normals.set(dirs[face],i*18+v*3);}i++;});
 return{faces,positions,normals,colors,stats:{terrainObjectCount:0,structureObjects:cells.length,faces:count,triangles:count*2,bufferBytes:positions.byteLength+normals.byteLength+colors.byteLength}};
}
