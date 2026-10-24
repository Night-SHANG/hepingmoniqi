"""Independent binary inventory checker. Python stdlib; no production code import."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import sys

HEADER = b'heping-independent-cell-inventory/v1\n'
FIXED = struct.Struct('<qiiiddIBB')
EXPORT = struct.Struct('<ihhhIddIB')

def inventory_digest(cells):
    h = hashlib.sha256(HEADER)
    previous = None
    for c in sorted(cells, key=lambda c: c['id']):
        if c['id'] == previous:
            raise ValueError('duplicate cell ID')
        previous = c['id']
        h.update(FIXED.pack(c['id'],c['x'],c['y'],c['z'],c['hp'],c['maxHp'],c['color'],bool(c['objective']),c.get('anchor') is True))
        for key in ('material','role','objectId'):
            value = c[key].encode('utf8')
            h.update(struct.pack('<I',len(value)))
            h.update(value)
    return h.hexdigest()

def read_export(binary, regions_path):
    data = Path(binary).read_bytes()
    if len(data) % EXPORT.size:
        raise ValueError(f'cell byte length {len(data)} is not a multiple of {EXPORT.size}')
    regions_doc = json.loads(Path(regions_path).read_text())
    regions = regions_doc['regions'] if isinstance(regions_doc, dict) else regions_doc
    rows=[]
    for ordinal, row in enumerate(EXPORT.iter_unpack(data)):
        id,x,y,z,region,hp,max_hp,color,flags=row
        if flags & ~3:
            raise ValueError(f'unknown flags at ordinal {ordinal}')
        r=regions[region]
        if r['index'] != region:
            raise ValueError(f'region index mismatch at ordinal {ordinal}')
        rows.append(dict(id=id,x=x,y=y,z=z,region=region,hp=hp,maxHp=max_hp,color=color,objective=bool(flags&1),anchor=bool(flags&2),material=r['material'],role=r['role'],objectId=r['objectId']))
    return rows,regions

def verify_geometry(cells, regions, contacts):
    # Enumerate every collider box into integer occupied centers, without using
    # the compiler's packing, neighbor or connected-component functions.
    directions=((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1))
    positions={(c['x'],c['y'],c['z']):i for i,c in enumerate(cells)}
    coverage_ok=connected_ok=True
    for r in regions:
        wanted={(cells[i]['x'],cells[i]['y'],cells[i]['z']) for i in r['cellOrdinals']}
        covered=Counter()
        for b in r['boxes']:
            axes=[]
            for a in ('x','y','z'):
                lo=b['center'][a]-b['halfExtents'][a]+.5
                hi=b['center'][a]+b['halfExtents'][a]-.5
                if abs(lo-round(lo))>1e-9 or abs(hi-round(hi))>1e-9 or hi<lo:
                    coverage_ok=False
                    axes.append([])
                else: axes.append(range(round(lo),round(hi)+1))
            for x in axes[0]:
                for y in axes[1]:
                    for z in axes[2]: covered[(x,y,z)]+=1
        coverage_ok=coverage_ok and set(covered)==wanted and all(v==1 for v in covered.values())
        if wanted:
            frontier=[next(iter(wanted))];seen=set(frontier)
            for x,y,z in frontier:
                for dx,dy,dz in directions:
                    p=(x+dx,y+dy,z+dz)
                    if p in wanted and p not in seen: seen.add(p);frontier.append(p)
            connected_ok=connected_ok and seen==wanted
    expected=set()
    for (x,y,z),i in positions.items():
        for dx,dy,dz in ((1,0,0),(0,1,0),(0,0,1)):
            j=positions.get((x+dx,y+dy,z+dz))
            if j is not None and cells[i]['region']!=cells[j]['region']:
                expected.add((min(i,j),max(i,j)))
    observed=set();valid=True;neighbors=[set() for _ in regions]
    for contact in contacts:
        a,b=contact['a'],contact['b'];pairs=contact['pairs']
        if not (0<=a<len(regions) and 0<=b<len(regions) and a!=b) or len(pairs)%2:
            valid=False;continue
        neighbors[a].add(b);neighbors[b].add(a)
        for i,j in zip(pairs[::2],pairs[1::2]):
            if not (0<=i<len(cells) and 0<=j<len(cells)):
                valid=False;continue
            pair=(min(i,j),max(i,j))
            if pair in observed or cells[i]['region']!=a or cells[j]['region']!=b: valid=False
            observed.add(pair)
    return {'exactOccupiedBoxCoverage':coverage_ok,'initialRegionsFaceConnected':connected_ok,
            'completeRealContactPairs':valid and observed==expected,
            'neighborListsMatchContacts':all(set(r['neighborIndices'])==neighbors[i] and len(r['neighborIndices'])==len(neighbors[i]) for i,r in enumerate(regions))}

def verify_export(binary, regions_path, manifest_path=None):
    expected=json.loads(Path(manifest_path or Path(__file__).with_name('oracle-manifest.json')).read_text())['fixture']
    cells,regions=read_export(binary,regions_path)
    actual_digest=inventory_digest(cells)
    checks={
        'inventorySha256':actual_digest==expected['inventorySha256'],
        'cellCount':len(cells)==expected['cellCount'],
        'uniqueOccupiedPositions':len({(c['x'],c['y'],c['z']) for c in cells})==len(cells),
        'structureCount':sum(c['role']!='terrain' for c in cells)==expected['structureCount'],
        'terrainCount':sum(c['role']=='terrain' for c in cells)==expected['terrainCount'],
        'buildingCount':len({c['objectId'] for c in cells if c['role'] in ('building','foundation')})==expected['buildingCount'],
        'perBuilding':dict(Counter(c['objectId'] for c in cells if c['role'] in ('building','foundation')))==expected['perBuilding'],
        'perMaterial':dict(Counter(c['material'] for c in cells))==expected['perMaterial'],
        'terrainLayers':dict(Counter(str(c['y']) for c in cells if c['role']=='terrain'))==expected['perLayer'],
        'anchorCount':sum(c['anchor'] for c in cells)==expected['anchorCount'],
    }
    bounds={f'{side}{axis.upper()}':op(c[axis] for c in cells) for side,op in [('min',min),('max',max)] for axis in ('x','y','z')}
    checks['bounds']=bounds==expected['bounds']
    membership=[[] for _ in regions]
    for i,c in enumerate(cells): membership[c['region']].append(i)
    checks['regionMembership']=all(sorted(r['cellOrdinals'])==membership[i] for i,r in enumerate(regions))
    region_doc=json.loads(Path(regions_path).read_text())
    checks.update(verify_geometry(cells,regions,region_doc.get('contacts',[]) if isinstance(region_doc,dict) else []))
    return {'schema':'heping-independent-export-check/v1','passed':all(checks.values()),'checks':checks,'inventorySha256':actual_digest,'expectedInventorySha256':expected['inventorySha256'],'cellCount':len(cells),'regionCount':len(regions),'physicsWorldsCreated':0}

if __name__=='__main__':
    if len(sys.argv)<3:
        raise SystemExit('usage: inventory_oracle.py data/city-cells.bin data/city-regions.json [oracle-manifest.json]')
    result=verify_export(*sys.argv[1:])
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['passed'] else 1)
