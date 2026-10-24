extends SceneTree
func _initialize():
 var loader = load("res://scripts/native_city_loader.gd")
 if loader == null:
  push_error("Required native city loader is missing")
  quit(1)
  return
 var city = loader.new().read_city("res://data")
 assert(city.cell_count == 454913)
 assert(city.building_count == 36)
 assert(city.terrain_count == 401800)
 assert(city.regions.size() == 18447)
 assert(city.cells.size() == 15921955)
 assert(city.node_count == 0)
 print("NATIVE_CITY_LOAD ",JSON.stringify(city.metrics))
 quit(0)
