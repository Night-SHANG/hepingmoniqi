from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent.parent
paths=[]
for dirname in ['scripts','scenes','assets','tests','vendor-notices','tools','.github']:
 for p in (root/dirname).rglob('*'):
  if p.is_file() and '.pyc' not in p.name and '__pycache__' not in p.parts and not p.name.endswith(('.import','.log')) and p.name not in ['preflight.json']:paths.append(p)
for p in (root/'data').glob('*'):
 if p.name not in ['city-regions.json','city-cells.bin']:paths.append(p)
for n in ['project.godot','export_presets.cfg','README.md','STAGE-2-RESULTS.md','docs/VOXEL-THIRD-PARTY-NOTICES.md','docs/EXPORT-NOTICE-BOUNDARY.md','docs/native-controls.md']:
 p=root/n
 if p.exists():paths.append(p)
rows=[dict(path=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),binary=p.suffix in ['.bin','.gz','.otf','.woff2','.png','.jpg']) for p in sorted(set(paths))]
(root/'probes/extension/ci-source-manifest.json').write_text(json.dumps(rows,indent=2)+'\n')
print(len(rows),sum(r['bytes'] for r in rows))
