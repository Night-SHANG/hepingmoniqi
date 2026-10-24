extends SceneTree

# The oracle reads source records directly, not the production block-index helper.
const Generator = preload("res://scripts/city_voxel_generator.gd")
const BLOCK_BYTES = 16384
const RECORD_BYTES = BLOCK_BYTES + 12
var failures: Array[String] = []
var checks = 0

func _initialize():
 var generator = Generator.new()
 if not generator.has_method("initialize_from_prebuilt"):
  _check("prebuilt initializer is available", false)
  quit(1)
  return
 _run()

func _run():
 var manifest = JSON.parse_string(FileAccess.get_file_as_string("res://data/manifest.json"))
 var metadata = JSON.parse_string(FileAccess.get_file_as_string("res://data/city-voxel-blocks.json"))
 var payload = FileAccess.get_file_as_bytes("res://data/city-voxel-blocks.bin")
 if not metadata is Dictionary or payload.is_empty():
  _check("checked-in prebuilt fixture exists",false)
  quit(1)
  return
 var generator = Generator.new()
 var result = generator.initialize_from_prebuilt(payload,metadata,manifest)
 _check("prebuilt city initializes",result.get("ok",false))
 if not result.get("ok",false):
  quit(1)
  return
 _check("pristine resources stay immutable",not generator.initialize_from_prebuilt(payload,metadata,manifest).ok)
 _check("metadata maintains complete city",result.cell_count==454913 and result.block_count==438 and result.nodes_created==0)
 _check("complete source bounds",generator.cell_bounds==AABB(Vector3(-122,-8,-102),Vector3(245,44,205)))
 var cells = FileAccess.get_file_as_bytes("res://data/city-cells.bin")
 var occupied = {}
 var mismatches = 0
 for i in int(manifest.cellCount):
  var p = Vector3i(cells.decode_s16(i*35+4),cells.decode_s16(i*35+6),cells.decode_s16(i*35+8))
  var want = (cells.decode_u32(i*35+30)<<8)|255
  occupied[p] = want
  if generator.get_raw_color(p)!=want: mismatches+=1
 _check("all 454913 source coordinates and raw colors match",mismatches==0)
 var rng = RandomNumberGenerator.new()
 rng.seed = 6441289
 mismatches=0
 for i in 12000:
  var p = Vector3i(rng.randi_range(-140,140),rng.randi_range(-20,45),rng.randi_range(-120,120))
  if generator.get_raw_color(p)!=occupied.get(p,0): mismatches+=1
 _check("seeded occupied and zero-air queries match independent oracle",mismatches==0)
 var layers = []
 for y in range(-8,0): layers.append(generator.get_raw_color(Vector3i(0,y,0))!=0)
 _check("eight terrain layers remain occupied",not layers.has(false) and generator.get_raw_color(Vector3i(0,-9,0))==0)
 var original = payload.duplicate()
 var first_block_origin=Vector3i(payload.decode_s32(0),payload.decode_s32(4),payload.decode_s32(8))*16
 var original_first_color=generator.get_raw_color(first_block_origin)
 payload[12]^=128
 _check("input buffer mutation cannot mutate generator",generator.get_raw_color(first_block_origin)==original_first_color)
 _reject("corrupted payload",payload,metadata,manifest)
 _reject("truncated payload",original.slice(0,original.size()-1),metadata,manifest)
 var changed=metadata.duplicate(true)
 changed.schema="godot-city-voxel-blocks/v2"
 _reject("unknown format version",original,changed,manifest)
 changed=metadata.duplicate(true);changed.source.sha256="0".repeat(64)
 _reject("different source SHA",original,changed,manifest)
 changed=metadata.duplicate(true);changed.source.bytes-=35
 _reject("different source length",original,changed,manifest)
 changed=metadata.duplicate(true);changed.cell_count-=1
 _reject("different source count",original,changed,manifest)
 changed=metadata.duplicate(true);changed.bounds.minX-=1
 _reject("different source bounds",original,changed,manifest)
 changed=metadata.duplicate(true);changed.block_size=32
 _reject("different block dimensions",original,changed,manifest)
 changed=metadata.duplicate(true);changed.color_depth_bits=16
 _reject("different channel depth",original,changed,manifest)
 changed=metadata.duplicate(true);changed.color_channel="CHANNEL_TYPE"
 _reject("different color channel",original,changed,manifest)
 changed=metadata.duplicate(true);changed.cell_order="x-y-z"
 _reject("different indexing order",original,changed,manifest)
 changed=metadata.duplicate(true);changed.color_encoding="rgb24"
 _reject("different raw color encoding",original,changed,manifest)
 changed=metadata.duplicate(true);changed.bounds.minX+=0.5
 _reject("fractional source bounds",original,changed,manifest)
 changed=metadata.duplicate(true);changed.bounds.erase("minX")
 _reject("missing bounds component",original,changed,manifest)
 changed=metadata.duplicate(true);changed.payload.sha256="z".repeat(64)
 _reject("malformed payload hash",original,changed,manifest)
 changed=metadata.duplicate(true);changed.source=[]
 _reject("malformed source descriptor",original,changed,manifest)
 changed=metadata.duplicate(true);changed.block_count+=0.5
 _reject("fractional block count",original,changed,manifest)
 var bad=original.duplicate()
 bad.encode_s32(0,100000)
 changed=metadata.duplicate(true);changed.payload.sha256=_sha(bad)
 _reject("block coordinate outside source bounds",bad,changed,manifest)
 bad=original.duplicate()
 for i in 12: bad[RECORD_BYTES+i]=bad[i]
 changed=metadata.duplicate(true);changed.payload.sha256=_sha(bad)
 _reject("duplicate block coordinate",bad,changed,manifest)
 # Invalid attempts must not partially publish blocks or poison a later valid load.
 var retry = Generator.new()
 _check("invalid attempt rejected",not retry.initialize_from_prebuilt(bad,changed,manifest).ok)
 _check("invalid attempt publishes no cells",retry.get_raw_color(Vector3i(0,-1,0))==0 and retry.cell_bounds==AABB())
 _check("valid load succeeds after invalid attempt",retry.initialize_from_prebuilt(original,metadata,manifest).ok)
 _test_builder_fixture()
 print("PREBUILT_VOXEL_BLOCKS ",JSON.stringify({"pass":failures.is_empty(),"checks":checks,"failures":failures,"metrics":result,"gpu_frame_verified":false}))
 quit(0 if failures.is_empty() else 1)

func _test_builder_fixture():
 var tmp=OS.get_environment("TEMP") if OS.get_name()=="Windows" else "/tmp"
 var directory=tmp.path_join("godot-prebuild-test-%d"%OS.get_process_id())
 DirAccess.make_dir_recursive_absolute(directory)
 var positions=[Vector3i(-17,-8,-17),Vector3i(-16,-1,-16),Vector3i(-1,0,-1),Vector3i(0,15,0),Vector3i(16,16,16)]
 var colors=[0x000000,0x123456,0xff0000,0x00ff00,0x0000ff]
 var cells=PackedByteArray();cells.resize(positions.size()*35);cells.fill(0)
 for i in positions.size():
  cells.encode_s16(i*35+4,positions[i].x);cells.encode_s16(i*35+6,positions[i].y);cells.encode_s16(i*35+8,positions[i].z)
  cells.encode_u32(i*35+30,colors[i])
 var manifest={"schema":"godot-city-fixture/v1","recordBytes":35,"littleEndian":true,"cellCount":positions.size(),"bounds":{"minX":-17,"minY":-8,"minZ":-17,"maxX":16,"maxY":16,"maxZ":16},"files":[{"name":"city-cells.bin","bytes":cells.size(),"sha256":_sha(cells)}]}
 _write_bytes(directory.path_join("city-cells.bin"),cells)
 _write_json(directory.path_join("manifest.json"),manifest)
 var output=[]
 var command="python" if OS.get_name()=="Windows" else "python3"
 var args=PackedStringArray([ProjectSettings.globalize_path("res://tools/prebuild-voxel-blocks.py"),"--directory",directory])
 var exit_code=OS.execute(command,args,output,true)
 _check("builder accepts signed-boundary and black-RGB fixture",exit_code==0)
 if exit_code==0:
  var payload=FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.bin"))
  var metadata=JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("city-voxel-blocks.json")))
  var gen=Generator.new()
  var loaded=gen.initialize_from_prebuilt(payload,metadata,manifest)
  _check("runtime consumes build-time fixture",loaded.ok)
  if loaded.ok:
   for i in positions.size(): _check("literal raw color at signed boundary %d"%i,gen.get_raw_color(positions[i])==((colors[i]<<8)|255))
   _check("black is occupied, adjacent air is zero",gen.get_raw_color(positions[0])==255 and gen.get_raw_color(positions[0]+Vector3i.UP)==0)
   var buffer=VoxelBuffer.new();buffer.create(16,16,16)
   gen._generate_block(buffer,Vector3i(-32,-16,-32),0)
   _check("native buffer preserves Y-fast negative local indexing and 32-bit color",buffer.get_channel_depth(VoxelBuffer.CHANNEL_COLOR)==VoxelBuffer.DEPTH_32_BIT and buffer.get_voxel(15,8,15,VoxelBuffer.CHANNEL_COLOR)==255 and buffer.get_voxel(8,15,15,VoxelBuffer.CHANNEL_COLOR)==0)
  var fallback=Generator.new()
  _check("raw initializer remains available for small fixtures",fallback.initialize_from_bytes(cells,manifest).ok)
  for i in positions.size(): _check("raw fixture fallback preserves color %d"%i,fallback.get_raw_color(positions[i])==((colors[i]<<8)|255))
  var first_meta=FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.json"))
  output=[]
  exit_code=OS.execute(command,args,output,true)
  _check("builder is byte deterministic",exit_code==0 and FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.bin"))==payload and FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.json"))==first_meta)
  var check_args=args.duplicate();check_args.append("--check")
  _check("builder check verifies committed generated outputs",OS.execute(command,check_args,[],true)==0)
  var saved_cells=cells.duplicate()
  var saved_manifest=manifest.duplicate(true)
  var altered=payload.duplicate();altered[12]^=1
  _write_bytes(directory.path_join("city-voxel-blocks.bin"),altered)
  _check("builder check rejects stale payload without overwriting it",OS.execute(command,check_args,[],true)!=0 and FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.bin"))==altered)
  _write_bytes(directory.path_join("city-voxel-blocks.bin"),payload)
  cells[0]^=1;_write_bytes(directory.path_join("city-cells.bin"),cells)
  _check("builder rejects source SHA mismatch",OS.execute(command,args,[],true)!=0)
  cells=saved_cells.duplicate();_write_bytes(directory.path_join("city-cells.bin"),cells)
  manifest.bounds.minX-=1;_write_json(directory.path_join("manifest.json"),manifest)
  _check("builder rejects coordinate extrema mismatch",OS.execute(command,args,[],true)!=0)
  manifest=saved_manifest.duplicate(true)
  cells.encode_u32(30,0xff123456);manifest.files[0].sha256=_sha(cells)
  _write_bytes(directory.path_join("city-cells.bin"),cells);_write_json(directory.path_join("manifest.json"),manifest)
  _check("builder rejects ambiguous alpha-packed input color",OS.execute(command,args,[],true)!=0)
  cells=saved_cells.duplicate();manifest=saved_manifest.duplicate(true)
  # Duplicate coordinate with valid source digest must be rejected, preserving prior outputs.
  cells.encode_s16(35+4,-17);cells.encode_s16(35+6,-8);cells.encode_s16(35+8,-17)
  manifest.files[0].sha256=_sha(cells)
  _write_bytes(directory.path_join("city-cells.bin"),cells);_write_json(directory.path_join("manifest.json"),manifest)
  _check("builder rejects duplicate source coordinate",OS.execute(command,args,[],true)!=0)
  _check("rejected build preserves existing good artifacts",FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.bin"))==payload and FileAccess.get_file_as_bytes(directory.path_join("city-voxel-blocks.json"))==first_meta)
 for name in ["city-cells.bin","manifest.json","city-voxel-blocks.bin","city-voxel-blocks.json"]:
  if FileAccess.file_exists(directory.path_join(name)): DirAccess.remove_absolute(directory.path_join(name))
 DirAccess.remove_absolute(directory)

func _reject(label:String,payload:PackedByteArray,metadata:Dictionary,manifest:Dictionary):
 var gen=Generator.new()
 var result=gen.initialize_from_prebuilt(payload,metadata,manifest)
 _check("reject "+label,not result.get("ok",true))
 _check("atomic "+label,gen.cell_bounds==AABB() and gen.get_raw_color(Vector3i(0,-1,0))==0)

func _sha(bytes:PackedByteArray)->String:
 var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes)
 return hash.finish().hex_encode()

func _write_bytes(path:String,bytes:PackedByteArray):
 var file=FileAccess.open(path,FileAccess.WRITE);file.store_buffer(bytes);file.close()

func _write_json(path:String,value:Dictionary):
 var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(value));file.close()

func _check(label:String,ok:bool):
 checks+=1
 if not ok:
  failures.append(label)
  printerr("FAIL ",label)
