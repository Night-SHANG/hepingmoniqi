"""Independent oracle regressions: no Godot scene or physics world is created."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent

class OracleTests(unittest.TestCase):
    def test_manifest_pins_the_actual_unreduced_city(self):
        m = json.loads((HERE / 'oracle-manifest.json').read_text())
        self.assertEqual(m['fixture']['cellCount'], 454913)
        self.assertEqual(m['fixture']['structureCount'], 53113)
        self.assertEqual(m['fixture']['terrainCount'], 401800)
        self.assertEqual(m['fixture']['buildingCount'], 36)
        self.assertEqual(m['fixture']['bounds'], {'minX':-122,'maxX':122,'minY':-8,'maxY':35,'minZ':-102,'maxZ':102})
        self.assertEqual(len(m['fixture']['inventorySha256']), 64)
        self.assertEqual(m['fixture']['terrainLayers'], list(range(-8, 0)))
        self.assertEqual(m['scope']['livePhysicsWorldsCreatedByOracle'], 0)
        self.assertEqual(m['fixture']['duplicatePositions'], 0)
        self.assertEqual(m['fixture']['duplicateIds'], 0)
        self.assertEqual(len(m['fixture']['perBuilding']), 36)

    def test_shot_inputs_are_fixed_and_nontrivial(self):
        m = json.loads((HERE / 'oracle-manifest.json').read_text())
        shots = m['nativeShots']
        self.assertEqual(len(shots), 3)
        self.assertEqual(len({tuple(s['position'].values()) for s in shots}), 3)
        self.assertEqual(len({s['objectId'] for s in shots}), 3)
        for i, s in enumerate(shots, 1):
            self.assertEqual((s['sequence'], s['radius'], s['damage'], s['impulse']), (i,48,20,12))
            self.assertGreater(s['pristineCandidateCellCount'], 1000)
        self.assertFalse(m['scope']['sameCentersAsHistoricalBrowserProven'])

    def test_binary_canonicalization_is_order_independent_and_sensitive(self):
        from inventory_oracle import inventory_digest
        a = {'id':-7,'x':0,'y':-1,'z':2,'hp':0.6,'maxHp':0.6,'color':5,'objective':False,'anchor':None,'material':'soil','role':'terrain','objectId':'qa'}
        b = dict(a, id=2**40+1, x=3, objective=True, material='wood')
        self.assertEqual(inventory_digest([a,b]), inventory_digest([b,a]))
        for field,value in [('x',1),('hp',0.5),('maxHp',0.7),('color',6),('objective',True),('anchor',True),('objectId','qb'),('material','road'),('role','building')]:
            self.assertNotEqual(inventory_digest([a,b]), inventory_digest([dict(a, **{field:value}),b]), field)
        with self.assertRaises(ValueError):
            inventory_digest([a,a])

if __name__ == '__main__':
    unittest.main()
