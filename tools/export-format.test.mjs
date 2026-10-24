import test from 'node:test';import assert from 'node:assert/strict';import {packCityCells} from './export-format.mjs';
test('little-endian records preserve negative IDs, coordinates, exact HP and flags',()=>{
 const cells=[{id:-7,x:-122,y:-8,z:102,region:4,hp:1.125,maxHp:3.25,color:0xab12ff,flags:3}];
 const b=packCityCells(cells);assert.equal(b.length,35);assert.equal(b.readInt32LE(0),-7);assert.equal(b.readInt16LE(4),-122);assert.equal(b.readInt16LE(6),-8);assert.equal(b.readUInt32LE(10),4);assert.equal(b.readDoubleLE(14),1.125);assert.equal(b.readDoubleLE(22),3.25);assert.equal(b.readUInt32LE(30),0xab12ff);assert.equal(b[34],3);
});
test('unsafe coordinate, duplicate ID and invalid HP fail without truncation',()=>{
 const c={id:1,x:0,y:0,z:0,region:0,hp:1,maxHp:1,color:0,flags:0};
 for(const patch of [{x:40000},{hp:NaN},{hp:2},{region:-1},{id:2**32}])assert.throws(()=>packCityCells([{...c,...patch}]));assert.throws(()=>packCityCells([c,c]));
});
