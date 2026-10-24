// THROWAWAY representation spike. This file is not imported by the game.
// No Rapier replacement, render policy, or production save-validator replacement.
import { GAME_SOIL_HP } from '../../src/structural/game-fixtures.ts';
import type { CellView, Point, Rotation } from '../../src/structural/types.ts';

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface TerrainConfig extends Bounds { map: string; originalColumn?: (x: number, z: number) => boolean }
export interface Change { id: number; hp: number; loss: number; state: CellView['state']; position: Point; rotation: Rotation; chunkId?: string }
interface MutableChunk { hp: Float64Array; state: Uint8Array }
interface Pose { position: Point; rotation: Rotation; chunkId?: string }
const states = ['static', 'dynamic', 'rubble', 'gone'] as const;
const identity = { x: 0, y: 0, z: 0, w: 1 };
const offsets = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
const local = (n: number) => n - Math.floor(n / 8) * 8;

/** Immutable finite descriptor + 2D historical-ID index + dirty 8³ arrays.
 * No Cell, State, position string, or neighbor array is stored for pristine soil.
 * HP is Float64, not Float32: it matches JS gameplay thresholds and exact saves.
 */
export class CompactTerrain {
  readonly cellCount: number;
  private readonly config: Readonly<TerrainConfig>;
  private readonly width: number;
  private readonly depth: number;
  private readonly columns: number;
  private readonly originalColumns: number;
  private readonly rankOfColumn?: Int32Array;
  private readonly columnOfRank?: Int32Array;
  private readonly chunks = new Map<string, MutableChunk>();
  private readonly poses = new Map<number, Pose>();
  private readonly changedIds = new Set<number>();

  constructor(config: TerrainConfig) {
    if (![config.minX,config.maxX,config.minZ,config.maxZ].every(Number.isSafeInteger) || config.maxX < config.minX || config.maxZ < config.minZ) throw new Error('Invalid finite bounds');
    // Do not retain the temporary topology builder/mask closure after ranking.
    this.config = Object.freeze({map:config.map,minX:config.minX,maxX:config.maxX,minZ:config.minZ,maxZ:config.maxZ});
    this.width = config.maxX - config.minX + 1; this.depth = config.maxZ - config.minZ + 1;
    this.columns = this.width * this.depth; this.cellCount = this.columns * 8;
    if (!Number.isSafeInteger(this.cellCount) || this.columns >= 2**31) throw new Error('Terrain index overflow');
    if (!config.originalColumn) { this.originalColumns = this.columns; return; }
    const old: number[] = [], added: number[] = [];
    for (let column = 0; column < this.columns; column++) {
      const { x,z } = this.pointOfColumn(column);
      (config.originalColumn(x,z) ? old : added).push(column);
    }
    this.originalColumns = old.length;
    this.rankOfColumn = new Int32Array(this.columns); this.columnOfRank = new Int32Array(this.columns);
    for (const [rank,column] of [...old,...added].entries()) { this.rankOfColumn[column] = rank; this.columnOfRank[rank] = column; }
  }

  private pointOfColumn(column: number) { return { x: this.config.minX + Math.floor(column / this.depth), z: this.config.minZ + column % this.depth }; }
  private address(p: Point) { return { key: `${Math.floor(p.x/8)},${Math.floor(p.y/8)},${Math.floor(p.z/8)}`, index: (local(p.x)*8+local(p.y))*8+local(p.z) }; }
  private write(p: Point) {
    const {key,index} = this.address(p); let chunk = this.chunks.get(key);
    if (!chunk) { chunk = {hp: new Float64Array(512).fill(NaN),state: new Uint8Array(512)}; this.chunks.set(key,chunk); }
    return {chunk,index};
  }
  /** Owned immutable-metadata query: original lattice coordinate, never current dynamic pose. */
  originalPosition(id: number): Point | null {
    if (!Number.isSafeInteger(id) || id >= 0 || -id > this.cellCount) return null;
    const n = -id - 1, old = this.originalColumns, added = this.columns-old;
    const prior = n < old*8;
    const blockIndex = prior ? n : n-old*8, size = prior ? old : added;
    const depth = Math.floor(blockIndex/size)+1, rank = blockIndex%size + (prior ? 0 : old);
    const column = this.columnOfRank?.[rank] ?? rank;
    return {...this.pointOfColumn(column),y:-depth};
  }
  idAt(x: number, y: number, z: number): number | null {
    const c = this.config;
    if (![x,y,z].every(Number.isSafeInteger) || x<c.minX || x>c.maxX || z<c.minZ || z>c.maxZ || y>-1 || y<-8) return null;
    const column = (x-c.minX)*this.depth+z-c.minZ, rank = this.rankOfColumn?.[column] ?? column;
    const d = -y-1, old = this.originalColumns;
    return rank < old ? -(1+d*old+rank) : -(1+8*old+d*(this.columns-old)+rank-old);
  }
  cell(id: number): CellView | null {
    const p = this.originalPosition(id); if (!p) return null;
    const {key,index} = this.address(p), chunk = this.chunks.get(key), maxHp = GAME_SOIL_HP[-p.y-1];
    const hpValue = chunk?.hp[index], hp = hpValue === undefined || Number.isNaN(hpValue) ? maxHp : hpValue;
    const state = states[chunk?.state[index] ?? 0], pose = this.poses.get(id), c = this.config;
    const color = p.y===-1 ? [0x8b9650,0x9aa45a,0x778448][Math.abs(p.x*7+p.z*11)%3]
      : [0x775238,0x8b6240,0x9a7048][Math.abs(p.x*73+p.y*31+p.z*17)%3];
    return {id,objectId:`game:${c.map}:geology`,role:'terrain',position:{...(pose?.position ?? p)},material:'soil',color,hp,maxHp,
      ...(p.y===-8&&(p.x===c.minX||p.x===c.maxX||p.z===c.minZ||p.z===c.maxZ)?{anchor:true}:{}),state,rotation:{...(pose?.rotation??identity)}};
  }
  staticAt(x: number, y: number, z: number): number | null {
    const id = this.idAt(x,y,z); if (id===null) return null;
    const {key,index} = this.address({x,y,z}); return (this.chunks.get(key)?.state[index] ?? 0) === 0 ? id : null;
  }
  damage(id: number, amount: number): number {
    if (!Number.isFinite(amount)||amount<=0) return 0;
    const c = this.cell(id); if (!c || c.hp===0) return 0;
    const {chunk,index} = this.write(this.originalPosition(id)!), used = Math.min(c.hp,amount);
    chunk.hp[index] = c.hp-used;
    if (chunk.hp[index] <= 1e-8) { chunk.hp[index]=0; chunk.state[index]=3; const pose=this.poses.get(id); if(pose)delete pose.chunkId; }
    this.changedIds.add(id); return used;
  }
  /** Actual rigid-body lifecycle stays in simulation/Rapier; only transfer state. */
  promote(id: number, chunkId: string, position: Point, rotation: Rotation, state: 'dynamic'|'rubble'): void {
    const c = this.cell(id); if(!c || c.hp<=0)throw new Error('Cannot promote an absent cell');
    const {chunk,index} = this.write(this.originalPosition(id)!); chunk.state[index] = states.indexOf(state);
    this.poses.set(id,{position:{...position},rotation:{...rotation},chunkId}); this.changedIds.add(id);
  }
  staticNeighbors(p: Point): number[] {
    const result: number[]=[];
    for (const [dx,dy,dz] of offsets) { const id=this.staticAt(p.x+dx,p.y+dy,p.z+dz); if(id!==null)result.push(id); }
    return result;
  }
  queryStaticSphere(p: Point, radius: number): number[] {
    const result: number[]=[],c=this.config;
    for(let x=Math.max(c.minX,Math.ceil(p.x-radius));x<=Math.min(c.maxX,Math.floor(p.x+radius));x++)
      for(let y=Math.max(-8,Math.ceil(p.y-radius));y<=Math.min(-1,Math.floor(p.y+radius));y++)
        for(let z=Math.max(c.minZ,Math.ceil(p.z-radius));z<=Math.min(c.maxZ,Math.floor(p.z+radius));z++){
          if(Math.hypot(x-p.x,y-p.y,z-p.z)>radius)continue;
          const id=this.staticAt(x,y,z);if(id!==null)result.push(id);
        }
    return result;
  }
  columnHit(x: number, z: number): number | null {
    for(let y=-1;y>=-8;y--)if(this.staticAt(x,y,z)!==null)return y+.5;
    return null;
  }
  /** Compatibility materialization is intentionally bounded, never a city API. */
  staticCellsInBounds(bounds: Bounds): CellView[] {
    const result: CellView[]=[];
    for(let x=bounds.minX;x<=bounds.maxX;x++)for(let z=bounds.minZ;z<=bounds.maxZ;z++)for(let y=-8;y<=-1;y++){
      const id=this.staticAt(x,y,z);if(id!==null)result.push(this.cell(id)!);
    }
    return result;
  }
  changes(): Change[] {
    return [...this.changedIds].sort((a,b)=>a-b).map(id=>{
      const c=this.cell(id)!,chunkId=this.poses.get(id)?.chunkId;
      return {id,hp:c.hp,loss:c.state==='static'?c.maxHp-c.hp:c.maxHp,state:c.state,position:c.position,rotation:c.rotation,...(chunkId?{chunkId}:{})};
    });
  }
  /** Only this spike's storage roundtrip; production needs the full strict
   * body/episode/queue/research validator before mutating the existing world. */
  restoreChanges(rows: readonly Change[]): void {
    const seen=new Set<number>();
    for(const row of rows){const p=this.originalPosition(row.id);if(!p||seen.has(row.id)||!Number.isFinite(row.hp)||row.hp<0||row.hp>GAME_SOIL_HP[-p.y-1]||!states.includes(row.state))throw new Error('Invalid sparse row');seen.add(row.id);}
    this.chunks.clear();this.poses.clear();this.changedIds.clear();
    for(const row of rows){const {chunk,index}=this.write(this.originalPosition(row.id)!);chunk.hp[index]=row.hp;chunk.state[index]=states.indexOf(row.state);this.changedIds.add(row.id);
      if(row.state!=='static')this.poses.set(row.id,{position:{...row.position},rotation:{...row.rotation},...(row.chunkId?{chunkId:row.chunkId}:{})});
    }
  }
  diagnostics() { return {cellCount:this.cellCount,mutableChunks:this.chunks.size,mutableBytes:this.chunks.size*512*9,columnIndexBytes:(this.rankOfColumn?.byteLength??0)+(this.columnOfRank?.byteLength??0),changedCells:this.changedIds.size,movingPoseRecords:this.poses.size}; }
}
