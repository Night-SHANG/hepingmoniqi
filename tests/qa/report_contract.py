"""Independent evidence reducer. Null means unmeasured, never success.

This file checks report consistency and acceptance thresholds. It does not create
physical evidence, and cannot turn a producer's self-report into independent QA.
"""
import json
import math
from pathlib import Path
import sys

MODES=('headless-accelerated','headless-real-time','software-window-real-time','native-window-real-time')
SEMANTICS=('wallHoleProjectile','eightLayerTerrainProjectile','foundationRelease','contactSecondaryDamage','persistentRubbleRehit','snapshotConservation','epochIsolation','pauseClock')

def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def close(a,b,epsilon=1e-6):return finite(a) and finite(b) and abs(a-b)<=epsilon

def evaluate(report,oracle):
    errors=[];g={}
    if report.get('schema')!='godot-same-city-report/v1':errors.append('unsupported report schema')
    mode=report.get('measurementMode');headless=isinstance(mode,str) and mode.startswith('headless-')
    if mode not in MODES:errors.append('unsupported measurement mode')
    shots=report.get('shots',[]);scope=report.get('scope',{});fixture=report.get('fixture',{})
    g['sameInventory']=all(fixture.get(k)==oracle['fixture'][k] for k in ('inventorySha256','cellCount','structureCount','terrainCount','buildingCount','bounds'))
    same_shots=len(shots)==3
    if same_shots:
        for i,s in enumerate(shots):
            c=s.get('command',{});e=oracle['nativeShots'][i]
            same_shots=same_shots and s.get('shot')==i+1 and s.get('accepted') is True and all(c.get(k)==e[k] for k in ('position','sequence','radius','damage','impulse','power')) and s.get('changedRegionCount',0)>0
    g['threeFixedNovas']=bool(same_shots and scope.get('resetBetweenShots') is False and scope.get('liveWorldsPeak')==1 and close(scope.get('stepSeconds'),1/120,1e-12))
    g['damagePlusCollision']=len(shots)==3 and all(finite(s.get('damagePlusCollisionMs')) and 0<=s['damagePlusCollisionMs']<250 and finite(s.get('authorityMs')) and finite(s.get('collisionSyncMs')) and 0<=s['authorityMs']+s['collisionSyncMs']<=s['damagePlusCollisionMs']+.001 for s in shots)
    def settled(s):
        q=s.get('settlement',{})
        return q.get('settled') is True and q.get('pendingGroups')==0 and q.get('activeBodies')==0 and all(q.get(k) is False for k in ('resetUsed','forcedSleepUsed','forcedGarbageCollectionUsed','screenshotDuringPressure')) and finite(q.get('simulatedSeconds')) and 0<=q['simulatedSeconds']<=scope.get('observationLimitSecondsPerShot',-1)
    g['naturalSimulationSettlement']=len(shots)==3 and all(settled(s) for s in shots)
    def clock_ok(s):
        c=s.get('clock',{});fields=('requestedMs','processedMs','discardedMs','debtMs','peakDebtMs','pausedMs','hiddenMs')
        return all(finite(c.get(k)) and c[k]>=0 for k in fields) and c['discardedMs']==0 and c['pausedMs']==0 and c['hiddenMs']==0 and close(c['requestedMs']-c['processedMs'],c['debtMs'],.01) and c['peakDebtMs']+.01>=c['debtMs'] and c['debtMs']<100
    g['clockConservation']=len(shots)==3 and all(clock_ok(s) for s in shots)
    g['naturalWallClockRecovery']=None if mode=='headless-accelerated' else bool(g['naturalSimulationSettlement'] and g['clockConservation'] and all(finite(s.get('settlement',{}).get('wallMs')) and s['settlement']['wallMs']>=0 for s in shots))
    def research_ok(s):
        r=s.get('research',{});fields=('before','after','delta','independentLossBefore','independentLossAfter','objectiveWeight','replayDelta')
        return all(finite(r.get(k)) for k in fields) and r['objectiveWeight']>0 and 0<=r['before']<=r['after']<=r['objectiveWeight']+1e-6 and close(r['after']-r['before'],r['delta']) and close(r['before'],r['independentLossBefore']) and close(r['after'],r['independentLossAfter']) and r['replayDelta']==0 and r.get('replayStateUnchanged') is True
    g['researchConservation']=len(shots)==3 and all(research_ok(s) for s in shots) and all(close(shots[i-1].get('research',{}).get('after'),shots[i].get('research',{}).get('before')) for i in range(1,len(shots)))
    presentation=[s.get('presentation',{}) for s in shots]
    if headless and any(p.get('actualRenderCount',0)!=0 or p.get('trustedInputObserved') is True or p.get('inputSamplesMs') or any(p.get(k) is not None for k in ('allDirectStaticRenderedMs','completeVisibleMs')) for p in presentation):
        errors.append('headless report contains presentation claims')
    def p95(a):return sorted(a)[math.ceil(len(a)*.95)-1] if a else math.inf
    g['input']=None if headless else len(shots)==3 and all(p.get('trustedInputObserved') is True and len(p.get('inputSamplesMs',[]))>0 and all(finite(n) and n>=0 for n in p['inputSamplesMs']) and p95(p['inputSamplesMs'])<100 for p in presentation)
    g['mainThreadStalls']=None if headless else len(shots)==3 and all(finite(p.get('maxMainThreadStallMs')) and 0<=p['maxMainThreadStallMs']<100 for p in presentation)
    g['allDirectStaticRendered']=None if headless else len(shots)==3 and all(finite(p.get('allDirectStaticRenderedMs')) and 0<=p['allDirectStaticRenderedMs']<500 and p.get('actualRenderCount',0)>0 and p.get('obligationsOutstanding')==0 for p in presentation)
    g['completeVisible']=None if headless else len(shots)==3 and all(finite(p.get('completeVisibleMs')) and 0<=p['completeVisibleMs']<500 and p.get('actualRenderCount',0)>0 for p in presentation)
    g['nativeGpu']=None if mode!='native-window-real-time' else report.get('provenance',{}).get('hardwareGpuVerified') is True
    semantic=report.get('semanticChecks',{})
    g['requiredSemantics']=None if not semantic else all(semantic.get(name,{}).get('passed') is True and len(semantic.get(name,{}).get('evidenceFiles',[]))>0 for name in SEMANTICS)
    cpu_keys=('sameInventory','threeFixedNovas','damagePlusCollision','naturalSimulationSettlement','clockConservation','researchConservation')
    if errors or any(g[k] is False for k in cpu_keys):verdict='failed-or-incomplete'
    elif headless:verdict='cpu-observations-only'
    elif all(v is True for v in g.values()):verdict='native-window-targets-observed'
    else:verdict='presentation-failed-or-native-gpu-unmeasured'
    return {'schema':'godot-independent-report-verdict/v1','gates':g,'errors':errors,'verdict':verdict,'caveat':'A report reducer verifies consistency, not the truth of self-reported physics or rendering. Keep the raw QA evidence and engine logs.'}

if __name__=='__main__':
    report=json.loads(Path(sys.argv[1]).read_text());oracle=json.loads(Path(__file__).with_name('oracle-manifest.json').read_text())
    result=evaluate(report,oracle);print(json.dumps(result,indent=2));raise SystemExit(1 if result['verdict']=='failed-or-incomplete' else 0)
