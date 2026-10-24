"""Assertions target changed geometry, not exporter metadata or VFX counters."""
import copy
import unittest
from inventory_oracle import verify_geometry

class GeometryOracleTests(unittest.TestCase):
    def fixture(self):
        cells=[dict(x=0,y=0,z=0,region=0),dict(x=1,y=0,z=0,region=0),dict(x=0,y=1,z=0,region=0),dict(x=2,y=0,z=0,region=1)]
        regions=[dict(index=0,cellOrdinals=[0,1,2],boxes=[dict(center=dict(x=.5,y=0,z=0),halfExtents=dict(x=1,y=.5,z=.5)),dict(center=dict(x=0,y=1,z=0),halfExtents=dict(x=.5,y=.5,z=.5))],neighborIndices=[1]),dict(index=1,cellOrdinals=[3],boxes=[dict(center=dict(x=2,y=0,z=0),halfExtents=dict(x=.5,y=.5,z=.5))],neighborIndices=[0])]
        contacts=[dict(a=0,b=1,pairs=[1,3])]
        return cells,regions,contacts

    def test_exact_sparse_coverage_and_contacts_pass(self):
        self.assertTrue(all(verify_geometry(*self.fixture()).values()))

    def test_filled_bounding_box_cannot_pass(self):
        cells,regions,contacts=self.fixture()
        regions[0]['boxes']=[dict(center=dict(x=.5,y=.5,z=0),halfExtents=dict(x=1,y=1,z=.5))]
        self.assertFalse(verify_geometry(cells,regions,contacts)['exactOccupiedBoxCoverage'])

    def test_same_total_volume_in_wrong_place_cannot_pass(self):
        cells,regions,contacts=self.fixture()
        regions[0]['boxes'][1]['center']['x']=1
        self.assertFalse(verify_geometry(cells,regions,contacts)['exactOccupiedBoxCoverage'])

    def test_missing_or_fake_face_contact_cannot_pass(self):
        cells,regions,contacts=self.fixture()
        self.assertFalse(verify_geometry(cells,regions,[])['completeRealContactPairs'])
        contacts[0]['pairs']=[0,3]
        self.assertFalse(verify_geometry(cells,regions,contacts)['completeRealContactPairs'])

    def test_disconnected_region_and_false_neighbor_cannot_pass(self):
        cells,regions,contacts=self.fixture()
        cells[2]['y']=3
        self.assertFalse(verify_geometry(cells,regions,contacts)['initialRegionsFaceConnected'])
        cells,regions,contacts=self.fixture()
        regions[0]['neighborIndices']=[]
        self.assertFalse(verify_geometry(cells,regions,contacts)['neighborListsMatchContacts'])

if __name__=='__main__': unittest.main()
