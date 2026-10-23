/** Shared first-playable contracts. Coordinates are world-space; y is up. */
export type Vec3 = { x: number; y: number; z: number };
export type MaterialId = 'wood' | 'stone' | 'roof' | 'glass' | 'metal';
export type WeaponId = 'pulse' | 'charge' | 'shock';
export interface Voxel { id: number; position: Vec3; color: number; material: MaterialId; hp: number; maxHp: number; anchored?: boolean; }
export interface DamageCommand { id: string; epoch: number; target: Vec3; weapon: WeaponId; power: number; }
export interface DamageResult { accepted: boolean; removed: Voxel[]; detached: Voxel[]; newlyDestroyed: number; researchEarned: number; destruction: number; }
export interface WorldSnapshot { epoch: number; voxels: Voxel[]; totalCount: number; destroyedCount: number; research: number; firstRewardClaimed: boolean; }
export interface WorldModel {
 readonly epoch: number;
 getVoxels(): readonly Voxel[];
 damage(command: DamageCommand): DamageResult;
 getSnapshot(): WorldSnapshot;
 reset(): void;
 restore(snapshot: WorldSnapshot): boolean;
}
export interface SceneApi {
 setVoxels(voxels: readonly Voxel[]): void;
 playDamage(result: DamageResult, target: Vec3, weapon: WeaponId): void;
 setTarget(target: Vec3 | null): void;
 setTimeScale(scale: number): void;
 resetCamera(): void;
 dispose(): void;
}
export interface SceneOptions { onAim: (target: Vec3) => void; onReady?: () => void; }
// Core module src/domain.ts exports createWorld(): WorldModel.
// Graphics module src/scene.ts exports createScene(container: HTMLElement, options: SceneOptions): SceneApi.
// Lead owns contracts.ts, main.ts, style.css, index.html, package/config files and integration.
