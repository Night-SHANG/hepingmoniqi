import type {CompactFixture} from '../compact/fixture';
import type {MaterialSurfaceSource} from '../material-slice/geometry';
/** Read-only render facade over the same permanent regional masks, not a second
 * damage world. Focus/camera never enters this query. */
export function createScaleSurface(source:CompactFixture,model:{isStaticCell(ordinal:number):boolean;cellHp(ordinal:number):number}):MaterialSurfaceSource {
 return {bounds:source.bounds,staticIdAt(x,y,z){const id=source.idAt(x,y,z);return id!==null&&model.isStaticCell(source.ordinal(id))?id:null;},colorOf:id=>source.colorOf(id),materialOf:id=>source.materialOf(id),hpOf:id=>model.cellHp(source.ordinal(id)),maxHpOf:id=>source.maxHpOf(id),forEachChunk:(size,visit)=>source.forEachChunk(size,visit)};
}
