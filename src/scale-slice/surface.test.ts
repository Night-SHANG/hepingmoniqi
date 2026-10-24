import test from 'node:test';import assert from 'node:assert/strict';
import {createScaleSurface} from './surface';
import {createCompactGameFixture} from '../compact/fixture';
test('surface preserves source colors while removed and dynamic cells are absent',()=>{const source=createCompactGameFixture('courtyard'),id=source.idAtOrdinal(0)!,ordinal=source.ordinal(id),p=source.originalPosition(id)!;let active=true;const model={isStaticCell:(i:number)=>active&&i===ordinal,cellHp:()=>3};const s=createScaleSurface(source,model);assert.equal(s.staticIdAt(p.x,p.y,p.z),id);assert.equal(s.colorOf(id),source.colorOf(id));assert.equal(s.hpOf(id),3);active=false;assert.equal(s.staticIdAt(p.x,p.y,p.z),null);assert.equal(s.staticIdAt(100000,100000,100000),null);});
