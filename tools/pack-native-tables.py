"""Offline adapter; keeps topology unchanged while removing JSON numeric Variants."""
import array,hashlib,json,sys
from pathlib import Path

def pack_tables(root):
 root=Path(root);source=json.loads((root/'city-regions.json').read_text());tables={k:[] for k in ('ids','materials','roles','objects')};lookups={k:{} for k in tables}
 def token(kind,value):
  if value not in lookups[kind]:lookups[kind][value]=len(tables[kind]);tables[kind].append(value)
  return lookups[kind][value]
 records=array.array('d');boxes=array.array('f');members=array.array('I');neighbors=array.array('I');headers=array.array('I');pairs=array.array('I')
 for r in source['regions']:
  b=r['bounds'];c=r['center'];record=[r['maxHp'],r['initialHp'],r['objectiveWeight'],c['x'],c['y'],c['z'],b['minX'],b['maxX'],b['minY'],b['maxY'],b['minZ'],b['maxZ'],r['color'],len(boxes)//6,len(r['boxes']),len(members),len(r['cellOrdinals']),len(neighbors),len(r['neighborIndices']),token('materials',r['material']),token('roles',r['role']),token('objects',r['objectId']),token('ids',r['id']),r['index']]
  records.extend(record);members.extend(r['cellOrdinals']);neighbors.extend(r['neighborIndices'])
  for box in r['boxes']:
   boxes.extend(box['center'][a] for a in ('x','y','z'));boxes.extend(box['halfExtents'][a] for a in ('x','y','z'))
 for c in source['contacts']:
  headers.extend([c['a'],c['b'],len(pairs),len(c['pairs'])]);pairs.extend(c['pairs'])
 out={}
 for name,data in [('regions',records),('boxes',boxes),('members',members),('neighbors',neighbors),('contacts',headers),('contact-pairs',pairs)]:
  if sys.byteorder!='little':data.byteswap()
  content=data.tobytes();(root/(name+'.bin')).write_bytes(content);out[name]={'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
 tables['region_stride']=24;tables['box_stride']=6;tables['contact_stride']=4;tables['schema']='godot-city-native-tables/v1';tables['files']=out
 (root/'native-tables.json').write_text(json.dumps(tables,separators=(',',':')))
 # Offline round-trip oracle checks all numeric records and topology from input.
 assert len(records)==len(source['regions'])*24
 for r in source['regions']:
  i=r['index']*24;assert records[i]==r['maxHp'];assert list(members[int(records[i+15]):int(records[i+15]+records[i+16])])==r['cellOrdinals'];assert list(neighbors[int(records[i+17]):int(records[i+17]+records[i+18])])==r['neighborIndices']
 for i,c in enumerate(source['contacts']):
  a,b,o,n=headers[i*4:i*4+4];assert (a,b)==(c['a'],c['b']);assert list(pairs[o:o+n])==c['pairs']
 print(json.dumps({'schema':tables['schema'],'region_count':len(source['regions']),'binary_bytes':sum(x['bytes'] for x in out.values()),'metadata_bytes':(root/'native-tables.json').stat().st_size,'roundtrip':'passed'}))
if __name__=='__main__':pack_tables(sys.argv[1])
