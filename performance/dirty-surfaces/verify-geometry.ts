import {createHash} from 'node:crypto';
/** Canonical exact full-attribute face hash; verification only, not retained by
 * the renderer. Sort is independent of chunk partition and visit ordering. */
export function hashGeometry(geometries:Iterable<{positions:Float32Array;normals:Int8Array;colors:Uint32Array}>){
 const rows:string[]=[];
 for(const g of geometries)for(let i=0;i<g.colors.length;i++)rows.push(`${g.colors[i]}|${g.positions.subarray(i*18,i*18+18).join(',')}|${g.normals.subarray(i*18,i*18+18).join(',')}`);
 rows.sort();const hash=createHash('sha256');for(const row of rows)hash.update(row+'\n');return{faces:rows.length,sha256:hash.digest('hex')};
}
