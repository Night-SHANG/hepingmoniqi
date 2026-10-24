/** Shared first-playable contracts. Coordinates are world-space; y is up. */
export type Vec3 = { x: number; y: number; z: number };
export type MaterialId = 'wood' | 'stone' | 'roof' | 'glass' | 'metal' | 'foliage';
/** Stable IDs: pulse=rocket, charge=grenade, shock=remote package. */
export type WeaponId = 'pulse' | 'charge' | 'shock' | 'echo' | 'split' | 'phase' | 'heavy' | 'nova';
/** Inventory counts; capacity is weighted separately by weaponCost. */
export type Loadout = Record<WeaponId,number>;
export type MapId = 'courtyard' | 'warehouse' | 'bridge' | 'tower' | 'cantilever' | 'neighborhood' | 'city';
export interface AimSurface { position:Vec3; normal:Vec3; voxelId:number|null; }
export interface ObjectiveState { mapId:MapId; title:string; total:number; destroyed:number; fraction:number; goal:number; complete:boolean; completedMaps:MapId[]; }
export interface Voxel { rotation?:{x:number;y:number;z:number;w:number}; structuralState?:'static'|'dynamic'|'rubble'; role?:'terrain'|'road'|'foundation'|'building'|'tree'|'bridge'; size?:Vec3; weight?:number; id: number; position: Vec3; color: number; material: MaterialId; hp: number; maxHp: number; anchored?: boolean; objectId?: string; group?: 'house' | 'tree' | 'fence' | 'crate' | 'table' | 'planter' | 'logs'; }
export interface DamageCommand { reward?:boolean; id: string; epoch: number; target: Vec3; weapon: WeaponId; power: number; }
export interface DamageResult { accepted: boolean; removed: Voxel[]; detached: Voxel[]; newlyDestroyed: number; researchEarned: number; destruction: number; }
export interface WorldSnapshot { schemaVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; structural?:unknown; round?:RoundState; mapId?:MapId; completedMaps?:MapId[]; epoch: number; voxels: Voxel[]; totalCount: number; destroyedCount: number; research: number; firstRewardClaimed: boolean; }
export interface RoundState { budget:number; used:number; startResearch:number; startDestroyed:number; settled:boolean; loadout?:Loadout; remaining?:Loadout; }
export interface RoundResult { used:number; budget:number; destruction:number; researchEarned:number; }
export interface WorldModel {
 getRound():RoundState;
 startRound(mapId:MapId,loadout:Loadout):boolean;
 recordShot(weapon?:WeaponId):boolean;
 finishRound():RoundResult;
 readonly epoch: number;
 getObjective():ObjectiveState;
 loadMap(mapId:MapId, free?:boolean):boolean;
 getVoxels(): readonly Voxel[];
 damage(command: DamageCommand): DamageResult;
 getSnapshot(): WorldSnapshot;
 reset(): void;
 restore(snapshot: WorldSnapshot): boolean;
}
export interface SceneApi {
 playStructuralEvent?(event:{id:string;epoch:number;position:Vec3;kind:string;tool?:WeaponId;scale?:number;material?:'soil'|'road'|MaterialId;intensity?:number}):void;
 getDiagnostics():{mapId:MapId;camera:{position:Vec3;target:Vec3;fov:number;far:number};groundBounds:{halfX:number;halfZ:number};renderedVoxelCount:number};
 projectPoint(point:Vec3):{x:number;y:number;visible:boolean};
 setMap(mapId:MapId):void;
 setReducedMotion(reduced:boolean):void;
 setVoxels(voxels: readonly Voxel[]): void;
 setCompactWorld(binding:import('./structural/types').StructuralCompactQueries|null):void;
 setProjectiles(projectiles: readonly ProjectileView[]): void;
 setTrajectory(preview:TrajectoryPreview|null):void;
 hasActiveEffects():boolean;
 clearEffects():void;
 getRenderedProjectileCount():number;
 getLaunchOrigin(target: Vec3): Vec3;
 getAimSurface(): AimSurface | null;
 playDamage(result: DamageResult, target: Vec3, weapon: WeaponId, power?: number): void;
 setTarget(target: Vec3 | null): void;
 setTimeScale(scale: number): void;
 resetCamera(): void;
 dispose(): void;
}
export interface SceneOptions { onAim: (target: Vec3) => void; onReady?: () => void; onFrame?: (scaledDeltaSeconds: number) => void; }
// Core module src/domain.ts exports createWorld(): WorldModel.
// Graphics module src/scene.ts exports createScene(container: HTMLElement, options: SceneOptions): SceneApi.
// Lead owns contracts.ts, main.ts, style.css, index.html, package/config files and integration.


/** Rapier owns ball motion/collisions. Game units only, not real-world weapons. */
export type DetonationMode = 'impact' | 'timed';
export type TriggerMode = 'automatic' | 'remote';
export interface TrajectoryPreview { points:Vec3[]; impact:Vec3|null; duration:number; }
export interface ProjectileCommand { trigger?:TriggerMode; id: string; epoch: number; origin: Vec3; target: Vec3; weapon: WeaponId; power: number; }
export interface ProjectileView { stage?:'parent'|'child'|'emitter'; id: string; position: Vec3; radius: number; weapon: WeaponId; age: number; fuseRemaining: number | null; velocity?:Vec3; rotation?:{x:number;y:number;z:number;w:number}; trigger?:TriggerMode; state?:'flying'|'attached'; normal?:Vec3; hostVoxelId?:number|null; }
export interface Detonation { stage?:'parent'|'child'|'emitter'; id: string; epoch: number; position: Vec3; weapon: WeaponId; power: number; reason: 'impact' | 'timer' | 'remote'; age: number; }
export interface AttachedCommand { weapon?:WeaponId; id:string; epoch:number; surface:AimSurface; power:number; }
export interface ProjectilePhysics {
 getPendingWorkCount?():number;
 reset?():void;
 preview(command:ProjectileCommand):TrajectoryPreview;
 attach(command:AttachedCommand):boolean;
 detonateAttached():Detonation[];
 setMap?(mapId:MapId):void;
 syncVoxels(voxels: readonly Voxel[], epoch: number): void;
 launch(command: ProjectileCommand): boolean;
 step(deltaSeconds: number): Detonation[];
 getProjectiles(): readonly ProjectileView[];
 dispose(): void;
}
// Physics worker exports async createProjectilePhysics(): Promise<ProjectilePhysics>
// from src/physics.ts. pulse impacts, charge uses a 3-second launch fuse; shock is placed/remote.
// Scene's onFrame receives scaled dt; caller advances physics then pushes ProjectileView.
