import copy
import json
from pathlib import Path
import unittest
from report_contract import evaluate

ORACLE=json.loads(Path(__file__).with_name('oracle-manifest.json').read_text())
def sample_report(mode='headless-accelerated'):
    return {'schema':'godot-same-city-report/v1','measurementMode':mode,
      'provenance':{'engineVersion':'4.7.1','physicsEngine':'Jolt Physics','renderer':'headless','hardwareGpuVerified':False},
      'fixture':copy.deepcopy(ORACLE['fixture']),
      'scope':{'resetBetweenShots':False,'liveWorldsPeak':1,'stepSeconds':1/120,'observationLimitSecondsPerShot':60},
      'shots':[{'shot':i,'command':copy.deepcopy(c),'accepted':True,'authorityMs':1,'collisionSyncMs':2,'damagePlusCollisionMs':3,'changedRegionCount':4,
                'settlement':{'settled':True,'wallMs':500,'simulatedSeconds':.5,'pendingGroups':0,'activeBodies':0,'sleepingBodies':2,'escapedBodies':0,'resetUsed':False,'forcedSleepUsed':False,'forcedGarbageCollectionUsed':False,'screenshotDuringPressure':False},
                'clock':{'requestedMs':500,'processedMs':500,'discardedMs':0,'debtMs':0,'peakDebtMs':25,'pausedMs':0,'hiddenMs':0},
                'research':{'before':4*(i-1),'after':4*i,'delta':4,'independentLossBefore':4*(i-1),'independentLossAfter':4*i,'objectiveWeight':20,'replayDelta':0,'replayStateUnchanged':True},
                'presentation':{'inputSamplesMs':[],'trustedInputObserved':False,'maxMainThreadStallMs':None,'allDirectStaticRenderedMs':None,'completeVisibleMs':None,'actualRenderCount':0,'obligationsOutstanding':None}}
               for i,c in enumerate(ORACLE['nativeShots'],1)]}

class ReportContractTests(unittest.TestCase):
    def test_headless_cannot_pass_visible_or_gpu_or_wall_recovery(self):
        result=evaluate(sample_report(),ORACLE)
        self.assertTrue(result['gates']['sameInventory'])
        self.assertTrue(result['gates']['threeFixedNovas'])
        self.assertTrue(result['gates']['damagePlusCollision'])
        self.assertIsNone(result['gates']['nativeGpu'])
        self.assertIsNone(result['gates']['input'])
        self.assertIsNone(result['gates']['allDirectStaticRendered'])
        self.assertIsNone(result['gates']['naturalWallClockRecovery'])
        self.assertEqual(result['verdict'],'cpu-observations-only')

    def test_false_presentation_evidence_in_headless_report_is_rejected(self):
        r=sample_report();r['shots'][0]['presentation']['actualRenderCount']=1
        self.assertIn('headless report contains presentation claims',evaluate(r,ORACLE)['errors'])

    def test_exact_threshold_is_failure(self):
        for value,wanted in [(249.999,True),(250,False),(251,False)]:
            r=sample_report();r['shots'][0]['damagePlusCollisionMs']=value
            self.assertEqual(evaluate(r,ORACLE)['gates']['damagePlusCollision'],wanted)

    def test_reduced_radius_missing_shot_reset_or_60hz_does_not_pass_identical_load(self):
        for mutate in [lambda r:r['shots'][0]['command'].update(radius=47), lambda r:r['shots'].pop(), lambda r:r['scope'].update(resetBetweenShots=True),lambda r:r['scope'].update(stepSeconds=1/60)]:
            r=sample_report();mutate(r)
            self.assertFalse(evaluate(r,ORACLE)['gates']['threeFixedNovas'])

    def test_clock_discard_or_fake_debt_is_failure(self):
        for mutate in [lambda c:c.update(discardedMs=1),lambda c:c.update(requestedMs=1000),lambda c:c.update(debtMs=100),lambda c:c.update(pausedMs=1)]:
            r=sample_report('headless-real-time');mutate(r['shots'][0]['clock'])
            self.assertFalse(evaluate(r,ORACLE)['gates']['naturalWallClockRecovery'])

    def test_nonconserved_or_duplicate_research_is_failure(self):
        for mutate in [lambda r:r.update(after=5),lambda r:r.update(replayDelta=1),lambda r:r.update(replayStateUnchanged=False),lambda r:r.update(independentLossAfter=21,after=21,delta=21)]:
            r=sample_report();mutate(r['shots'][0]['research'])
            self.assertFalse(evaluate(r,ORACLE)['gates']['researchConservation'])

    def test_software_window_never_establishes_native_gpu(self):
        r=sample_report('software-window-real-time')
        for s in r['shots']:
            s['presentation'].update(inputSamplesMs=[5,8],trustedInputObserved=True,maxMainThreadStallMs=12,allDirectStaticRenderedMs=100,completeVisibleMs=101,actualRenderCount=5,obligationsOutstanding=0)
        result=evaluate(r,ORACLE)
        self.assertTrue(result['gates']['input'])
        self.assertTrue(result['gates']['allDirectStaticRendered'])
        self.assertIsNone(result['gates']['nativeGpu'])
        self.assertNotEqual(result['verdict'],'native-window-targets-observed')

if __name__=='__main__':unittest.main()
