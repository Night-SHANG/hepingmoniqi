import {test} from 'node:test';import assert from 'node:assert/strict';import {createContactFixture} from './contact-fixture.js';import {createStructuralSimulation} from './simulation.js';
test('explicit contact calibration settles physical building rubble after damaging a separate receiver',async()=>{
 const s=await createStructuralSimulation(createContactFixture());try{
 assert.equal(s.pending(),0);assert.ok(s.blast({id:'cut',epoch:s.epoch,position:{x:.4246666749,y:.3347795696,z:.4900000095},radius:.8,damage:100,impulse:0}));
 for(let i=0;i<2400&&s.pending();i++)s.step(1/120);
 assert.equal(s.pending(),0);assert.ok(s.views().some(v=>v.role==='building'&&v.state==='rubble'));assert.ok(s.views().find(v=>v.id===11)!.hp<30);assert.ok(s.events().some(e=>e.kind==='impact'&&e.targetId===11));
 const before=s.views(),rp=s.research();for(let i=0;i<240;i++)s.step(1/120);assert.deepEqual(s.views(),before);assert.equal(s.research(),rp);
 }finally{s.dispose();}
});
