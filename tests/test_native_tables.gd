extends SceneTree
func _initialize():
 var loader = load("res://scripts/native_city_loader.gd").new()
 if not loader.has_method("read_native"):
  push_error("Packed native table loader required")
  quit(1)
  return
 var city = loader.read_native("res://data")
 assert(city.regions.size() == 18447 * 24)
 assert(city.boxes.size() == 23339 * 6)
 assert(city.members.size() == 454913)
 assert(city.contact_pairs.size() == 390489 * 2)
 assert(city.cells.size() == 15921955)
 print("NATIVE_PACKED_CITY_LOAD ", JSON.stringify(city.metrics))
 quit(0)
