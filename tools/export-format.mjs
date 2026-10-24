export function packCityCells(cells){
 const out=Buffer.alloc(cells.length*35),ids=new Set();
 const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 for(let i=0;i<cells.length;i++){
  const c=cells[i],o=i*35;
  if(!integer(c.id,-2147483648,2147483647)||ids.has(c.id))throw new RangeError('Invalid or duplicate cell ID');ids.add(c.id);
  if(![c.x,c.y,c.z].every(n=>integer(n,-32768,32767))||!integer(c.region,0,4294967295)||!integer(c.color,0,4294967295)||!integer(c.flags,0,3)||!Number.isFinite(c.hp)||!Number.isFinite(c.maxHp)||c.hp<0||c.maxHp<=0||c.hp>c.maxHp)throw new RangeError('Invalid cell record');
  out.writeInt32LE(c.id,o);out.writeInt16LE(c.x,o+4);out.writeInt16LE(c.y,o+6);out.writeInt16LE(c.z,o+8);out.writeUInt32LE(c.region,o+10);out.writeDoubleLE(c.hp,o+14);out.writeDoubleLE(c.maxHp,o+22);out.writeUInt32LE(c.color,o+30);out[o+34]=c.flags;
 }
 return out;
}
