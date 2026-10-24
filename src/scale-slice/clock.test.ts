import test from 'node:test';import assert from 'node:assert/strict';
import {ScaleClock} from './clock';
test('foreground overload remains explicit debt while bounded pumps make progress',()=>{const c=new ScaleClock();c.admit(1000);let n=0;c.pump(()=>n++,8);assert.equal(n,8);assert.ok(c.stats().debtMs>930);for(let i=0;i<15;i++)c.pump(()=>n++,8);assert.equal(n,120);assert.ok(c.stats().debtMs<1e-7);assert.equal(c.stats().discardedMs,0);});
test('paused/hidden intervals never create catch-up work and reset is explicit',()=>{const c=new ScaleClock();c.admit(500,{paused:true});c.admit(500,{hidden:true});assert.equal(c.stats().debtMs,0);c.admit(100);c.reset();assert.equal(c.stats().discardedMs,100);assert.equal(c.stats().debtMs,0);});
