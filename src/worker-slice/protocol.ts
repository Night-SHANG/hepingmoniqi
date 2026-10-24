import type {AimSurface,AttachedCommand,DamageResult,Detonation,Loadout,MapId,ObjectiveState,ProjectileCommand,ProjectileView,RoundState} from '../contracts.js';
import type {StructuralEvent} from '../structural/types.js';
/** Logical transport epoch is independent of the private Rapier/game-world epoch. */
export interface AuthorityEnvelope {worldId:string;epoch:number;sequence:number;mapRecipeHash:string}
export interface AuthorityCommandBase extends AuthorityEnvelope {commandId:string;observedRevision:number}
export type AuthorityCommand=AuthorityCommandBase & (
 |{kind:'initialize';mode:'main'|'free';mapId:MapId;loadout?:Loadout;fixture?:'research-1400'}
 |{kind:'launch';shot:Omit<ProjectileCommand,'epoch'>}
 |{kind:'place';placement:Omit<AttachedCommand,'epoch'|'surface'>&{surface:Omit<AimSurface,'voxelId'>&{voxelId?:number|null}}}
 |{kind:'detonate'}
 |{kind:'clock';paused?:boolean;hidden?:boolean;timeScale?:number}
 |{kind:'end';criticalEffectsPending:boolean}
 |{kind:'save'}
 |{kind:'restore';saveText:string}
 |{kind:'reset';mapId?:MapId;loadout?:Loadout}
 |{kind:'event-ack';throughEventSequence:number}
 |{kind:'pose-ack';poseSequence:number}
 |{kind:'dispose'}
);
export interface AuthorityClock {
 foregroundEligibleMs:number;requestedSimulationMs:number;processedSimulationMs:number;simulationDebtMs:number;
 /** Idle quanta do not invoke Rapier: the existing kernel deliberately sleeps an idle world. */
 processedQuanta:number;solverSteps:number;discardedSimulationMs:number;discardedByResetMs:number;
 transitionWallMs:number;pausedWallMs:number;hiddenWallMs:number;backpressureWallMs:number;paused:boolean;hidden:boolean;timeScale:number;
 lastPumpSteps:number;lastPumpDurationMs:number;
}
export interface AuthoritySummary extends AuthorityEnvelope {
 authorityRevision:number;bindingRevision:number;mode:'main'|'free';mapId:MapId;research:number;round:RoundState;objective:ObjectiveState;
 pendingWork:number;ordnancePending:number;structuralPending:number;queuedCommands:number;oldestQueuedCommandAgeMs:number;
 unacknowledgedEventBatches:number;eventSequence:number;poseInFlight:boolean;
 state:'active'|'paused'|'hidden'|'consumer-backpressure'|'fault'|'disposed';fault:string|null;clock:AuthorityClock;
}
export type AuthorityGameplayEvent=
 |{kind:'structural';event:StructuralEvent}
 |{kind:'damage';detonation:Detonation;result:DamageResult};
export interface AuthorityAck extends AuthorityEnvelope {
 kind:'ack';commandId:string;commandSequence:number;status:'accepted'|'rejected';committed:boolean;duplicate:boolean;reason?:string;
 summary:AuthoritySummary|null;receivedAtMs:number;startedAtMs:number;committedAtMs:number;saveText?:string;surface?:AimSurface;
}
export interface AuthorityEvents extends AuthorityEnvelope {kind:'events';eventSequence:number;authorityRevision:number;committedAtMs:number;events:AuthorityGameplayEvent[]}
export interface AuthorityPoses extends AuthorityEnvelope {
 kind:'poses';poseSequence:number;authorityRevision:number;bindingRevision:number;sampledAtMs:number;
 /** Independently allocated complete moving-cell batch. No live authority buffer is detached. Current map IDs fit signed 32 bits; future maps must revalidate this bound. */
 cellIds:Int32Array;colors:Uint32Array;positions:Float32Array;rotations:Float32Array;projectiles:ProjectileView[];
}
export type AuthorityMessage=AuthorityAck|AuthorityEvents|AuthorityPoses|({kind:'summary';summary:AuthoritySummary}&AuthorityEnvelope);
