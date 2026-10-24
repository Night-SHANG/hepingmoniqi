"""Fetch only pinned official Godot/Voxel Tools assets; no third-party install scripts."""
import hashlib, os, pathlib, platform, urllib.request, zipfile
root=pathlib.Path(__file__).resolve().parent.parent
cache=root/'.ci-tools';cache.mkdir(exist_ok=True)
# Stored compressed solely to stay below the connector request-size limit.
compressed=root/'data/city-cells.bin.gz'
if compressed.exists():
 import gzip
 raw=gzip.decompress(compressed.read_bytes())
 assert hashlib.sha256(raw).hexdigest()=='da1492c3b63a7b60cc354c106852c2842f61d85d538340dc7a3eaf8b500ef5ff'
 (root/'data/city-cells.bin').write_bytes(raw)
windows=platform.system()=='Windows' 
def get(name,url,digest,algorithm='sha256'):
 p=cache/name
 if not p.exists():
  urllib.request.urlretrieve(url,p)
 assert hashlib.new(algorithm,p.read_bytes()).hexdigest()==digest, f'Checksum mismatch: {name}'
 return p
def extract(p,destination,predicate=lambda x:True):
 with zipfile.ZipFile(p) as z:
  for n in z.namelist():
   if not predicate(n):continue
   target=(destination/n).resolve()
   assert target.is_relative_to(destination.resolve()),n
   z.extract(n,destination)
base='https://github.com/godotengine/godot-builds/releases/download/4.7.1-stable/'
name='Godot_v4.7.1-stable_win64.exe.zip' if windows else 'Godot_v4.7.1-stable_linux.x86_64.zip'
digest='a6b02c527c18ba9936e63562032701432b2dc57d98d6483ceaccb00fe14af16af5773ae8a55e7b4d614edf121c4d9e420d870f804edb1dac16362298a01ce6c4' if windows else 'c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba'
extract(get(name,base+name,digest,'sha512' if windows else 'sha256'),cache)
engine=cache/('Godot_v4.7.1-stable_win64_console.exe' if windows else 'Godot_v4.7.1-stable_linux.x86_64')
engine.chmod(0o755)
voxel=get('GodotVoxelExtension.zip','https://github.com/Zylann/godot_voxel/releases/download/v1.7x/GodotVoxelExtension.zip','600737572a5e25541ba6f503e842a3717ba19afafa5474510a6ceff995a1d2d8')
extract(voxel,root)
if windows:
 tpz=get('templates.tpz',base+'Godot_v4.7.1-stable_export_templates.tpz','86409db6200b6f8fd3230989c2d2002851f3dd18acf11d7bdbafddf5a0dd0f72')
 dest=pathlib.Path(os.environ['APPDATA'])/'Godot/export_templates/4.7.1.stable';dest.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(tpz) as z:
  for n in z.namelist():
   if pathlib.PurePosixPath(n).name.startswith('windows_') and 'x86_64' in n:
    (dest/pathlib.PurePosixPath(n).name).write_bytes(z.read(n))
with open(os.environ['GITHUB_ENV'],'a') as f:f.write(f'GODOT={engine}\n')
print('OFFICIAL_DEPENDENCIES_VERIFIED',engine)
