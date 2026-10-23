import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('page declares its shipped multi-resolution icon',()=>{
 const html=readFileSync('index.html','utf8');
 assert.match(html,/<link\b[^>]*rel="icon"[^>]*href="\.\/favicon\.ico"/);
 const ico=readFileSync('public/favicon.ico');
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.ok(ico.readUInt16LE(4)>=2);
 for(let i=0;i<ico.readUInt16LE(4);i++){
  const offset=6+i*16,size=ico.readUInt32LE(offset+8),start=ico.readUInt32LE(offset+12);
  assert.ok(start>=6+ico.readUInt16LE(4)*16 && start+size<=ico.length);
 }
});
