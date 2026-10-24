import type {MapId} from '../contracts.js';
import type {StructuralCompactQueries} from '../structural/types.js';
import {getManagedCompactGameFixture} from './managed-fixture.js';
import {CompactAuthorityStore} from './store.js';
import {createCompactQuerySource} from './surface-source.js';
/** Selection-only descriptor. No Rapier, authority world or full CellView list. */
export function createCompactPreview(map:MapId):StructuralCompactQueries {
 const fixture=getManagedCompactGameFixture(map),store=new CompactAuthorityStore(fixture);
 const source=createCompactQuerySource(store,()=>0);
 return Object.freeze({fixture,source,get revision(){return store.revision;},changesSince:store.changesSince.bind(store),cell(id:number){const c=store.read(id);return c?Object.freeze({...c.spec,hp:c.hp,state:c.state,position:Object.freeze(c.position),rotation:Object.freeze(c.rotation)}):null;},movingViews:()=>[],changedCells:()=>[],aggregate:store.aggregate.bind(store),diagnostics:store.diagnostics.bind(store)});
}
