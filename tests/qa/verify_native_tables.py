"""Read-only independent decoder for the Godot typed bridge. No producer import."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
from inventory_oracle import EXPORT

def verify_native_tables(root):
    root=Path(root)
    meta=json.loads((root/'native-tables.json').read_text())
    expected=json.loads((root/'city-regions.json').read_text())
    checks={'schemaAndStrides':meta.get('schema')=='godot-city-native-tables/v1' and [meta.get(k) for k in ('region_stride','box_stride','contact_stride')]==[24,6,4]}
    raw={k:(root/f'{k}.bin').read_bytes() for k in ('regions','boxes','members','neighbors','contacts','contact-pairs')}
    checks['allFileLengthsAndHashes']=all(len(v)==meta['files'][k]['bytes'] and hashlib.sha256(v).hexdigest()==meta['files'][k]['sha256'] for k,v in raw.items())
    tables={k:[r[0] for r in struct.iter_unpack('<'+('d' if k=='regions' else 'f' if k=='boxes' else 'I'),v)] for k,v in raw.items()}
    rows=tables['regions'];boxes=tables['boxes'];members=tables['members'];neighbors=tables['neighbors'];pairs=tables['contact-pairs'];headers=tables['contacts']
    checks['allNumericValuesFinite']=all(math.isfinite(n) for k in ('regions','boxes') for n in tables[k])
    checks['exactNumericArrayLengths']=(len(rows)==len(expected['regions'])*24 and len(boxes)==sum(len(r['boxes'])*6 for r in expected['regions']) and len(members)==sum(len(r['cellOrdinals']) for r in expected['regions']) and len(neighbors)==sum(len(r['neighborIndices']) for r in expected['regions']) and len(headers)==len(expected['contacts'])*4 and len(pairs)==sum(len(c['pairs']) for c in expected['contacts']))
    reconstructed=[];offset_boxes=offset_members=offset_neighbors=0;indices_ok=True;offsets_ok=True
    def integer(v):
        nonlocal indices_ok
        indices_ok=indices_ok and math.isfinite(v) and v>=0 and v==int(v)
        return int(v)
    for offset in range(0,len(rows),24):
        v=rows[offset:offset+24]
        bi,bn,mi,mn,ni,nn=[integer(v[i]) for i in range(13,19)]
        offsets_ok=offsets_ok and (bi,mi,ni)==(offset_boxes,offset_members,offset_neighbors)
        offset_boxes+=bn;offset_members+=mn;offset_neighbors+=nn
        rb=[]
        for o in range(bi*6,(bi+bn)*6,6):
            rb.append({'center':dict(zip(('x','y','z'),boxes[o:o+3])),'halfExtents':dict(zip(('x','y','z'),boxes[o+3:o+6]))})
        reconstructed.append(dict(maxHp=v[0],initialHp=v[1],objectiveWeight=v[2],center=dict(zip(('x','y','z'),v[3:6])),bounds=dict(zip(('minX','maxX','minY','maxY','minZ','maxZ'),v[6:12])),color=integer(v[12]),boxes=rb,cellOrdinals=members[mi:mi+mn],neighborIndices=neighbors[ni:ni+nn],material=meta['materials'][integer(v[19])],role=meta['roles'][integer(v[20])],objectId=meta['objects'][integer(v[21])],id=meta['ids'][integer(v[22])],index=integer(v[23])))
    contacts=[];offset_pairs=0
    for offset in range(0,len(headers),4):
        a,b,o,n=headers[offset:offset+4];offsets_ok=offsets_ok and o==offset_pairs;offset_pairs+=n
        contacts.append(dict(a=a,b=b,pairs=pairs[o:o+n]))
    checks['integralInRangeOffsetsAndTokens']=indices_ok and all(r['index']==i for i,r in enumerate(reconstructed))
    checks['denselyPackedOffsetsNoDroppedData']=offsets_ok and (offset_boxes*6,offset_members,offset_neighbors,offset_pairs)==(len(boxes),len(members),len(neighbors),len(pairs))
    checks['allRegionFieldsExactlyPreserved']=reconstructed==expected['regions']
    checks['allContactsExactlyPreserved']=contacts==expected['contacts']
    cells=(root/'city-cells.bin').read_bytes();ids=[r[0] for r in EXPORT.iter_unpack(cells)]
    checks['negativeTerrainIdsRemainSigned']=sum(i<0 for i in ids)==401800 and min(ids)==-401800 and -1 in ids
    checks['cellBytesUnchanged']=hashlib.sha256(cells).hexdigest()=='da1492c3b63a7b60cc354c106852c2842f61d85d538340dc7a3eaf8b500ef5ff'
    return {'schema':'heping-independent-native-table-check/v1','passed':all(checks.values()),'checks':checks,'regionCount':len(reconstructed),'boxCount':offset_boxes,'contactPairCount':len(pairs)//2,'negativeCellIdCount':sum(i<0 for i in ids),'binaryTableBytes':sum(map(len,raw.values())),'physicsWorldsCreated':0,'limitations':['File decoding is not Godot physics, rendered meshes, GPU timing, or runtime memory validation.']}

if __name__=='__main__':
    result=verify_native_tables(sys.argv[1]);print(json.dumps(result,indent=2));raise SystemExit(0 if result['passed'] else 1)
