/** Shared first-playable contracts. Coordinates are world-space; y is up. */
export type Vec3 = { x: number; y: number; z: number };
export type MaterialId = 'wood' | 'stone' | 'roof' | 'glass' | 'metal' | 'foliage';
/** Stable IDs: pulse=rocket, charge=grenade, shock=remote package. */
export type WeaponId = 'pulse' | 'charge' | 'shock';
export type MapId = 'courtyard' | 'warehouse';
export interface AimSurface { position:Vec3; normal:Vec3; voxelId:number; }
export interface ObjectiveState { mapId:MapId; title:string; total:number; destroyed:number; fraction:number; goal:number; complete:boolean; completedMaps:MapId[]; }
export interface Voxel { id: number; position: Vec3; color: number; material: MaterialId; hp: number; maxHp: number; anchored?: boolean; objectId?: string; group?: 'house' | 'tree' | 'fence' | 'crate' | 'table' | 'planter' | 'logs'; }
export interface DamageCommand { id: string; epoch: number; target: Vec3; weapon: WeaponId; power: number; }
export interface DamageResult { accepted: boolean; removed: Voxel[]; detached: Voxel[]; newlyDestroyed: number; researchEarned: number; destruction: number; }
export interface WorldSnapshot { schemaVersion?: 2 | 3; mapId?:MapId; completedMaps?:MapId[]; epoch: number; voxels: Voxel[]; totalCount: number; destroyedCount: number; research: number; firstRewardClaimed: boolean; }
export interface WorldModel {
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
 setVoxels(voxels: readonly Voxel[]): void;
 setProjectiles(projectiles: readonly ProjectileView[]): void;
 getLaunchOrigin(target: Vec3): Vec3;
 getAimSurface(): AimSurface | null;
 playDamage(result: DamageResult, target: Vec3, weapon: WeaponId): void;
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
export interface ProjectileCommand { id: string; epoch: number; origin: Vec3; target: Vec3; weapon: WeaponId; power: number; }
export interface ProjectileView { id: string; position: Vec3; radius: number; weapon: WeaponId; age: number; fuseRemaining: number | null; velocity?:Vec3; rotation?:{x:number;y:number;z:number;w:number}; state?:'flying'|'attached'; normal?:Vec3; hostVoxelId?:number; }
export interface Detonation { id: string; epoch: number; position: Vec3; weapon: WeaponId; power: number; reason: 'impact' | 'timer' | 'remote'; age: number; }
export interface AttachedCommand { id:string; epoch:number; surface:AimSurface; power:number; }
export interface ProjectilePhysics {
 attach(command:AttachedCommand):boolean;
 detonateAttached():Detonation[];
 syncVoxels(voxels: readonly Voxel[], epoch: number): void;
 launch(command: ProjectileCommand): boolean;
 step(deltaSeconds: number): Detonation[];
 getProjectiles(): readonly ProjectileView[];
 dispose(): void;
}
// Physics worker exports async createProjectilePhysics(): Promise<ProjectilePhysics>
// from src/physics.ts. pulse impacts, charge uses a 3-second launch fuse; shock is placed/remote.
// Scene's onFrame receives scaled dt; caller advances physics then pushes ProjectileView.
