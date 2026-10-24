import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactStructures } from './compact-structures.ts';
test('color scalar preserves immutable packed RGB without constructing a view',()=>{
 const source={id:1,objectId:'test',role:'building' as const,position:{x:0,y:0,z:0},material:'wood' as const,color:0xa94633,hp:2,maxHp:2};
 const store=new CompactStructures([source]);source.color=0;
 assert.equal(store.colorAt(0),0xa94633);
 for(const index of [-1,.1,NaN,1])assert.equal(store.colorAt(index),null);
});
