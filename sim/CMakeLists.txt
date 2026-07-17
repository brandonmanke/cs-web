set(CS_SIM_SOURCES
  src/world.cpp
  src/pmove.cpp
  src/weapons.cpp
  src/sim.cpp
)

if(EMSCRIPTEN)
  add_executable(sim_wasm ${CS_SIM_SOURCES})
  target_include_directories(sim_wasm PUBLIC include PRIVATE src)
  target_link_libraries(sim_wasm PRIVATE box3d)
  target_compile_options(sim_wasm PRIVATE -fno-exceptions -fno-rtti -Wall -Wextra)
  target_link_options(sim_wasm PRIVATE
    "--no-entry"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createSimModule"
    "-sENVIRONMENT=web,node" # node included so the sim can be smoke-tested headless
    "-sSINGLE_FILE=1"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sEXPORTED_FUNCTIONS=_sim_create,_sim_world_reset,_sim_add_box,_sim_add_hull,_sim_add_mesh,_sim_world_finalize,_sim_spawn,_sim_add_target,_sim_step,_sim_snapshot,_sim_snapshot_bytes,_malloc,_free"
    "-sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU32,HEAP32"
  )
  set_target_properties(sim_wasm PROPERTIES
    OUTPUT_NAME "sim"
    SUFFIX ".mjs"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/client/src/generated"
  )
else()
  add_library(cs_sim STATIC ${CS_SIM_SOURCES})
  target_include_directories(cs_sim PUBLIC include PRIVATE src)
  target_link_libraries(cs_sim PUBLIC box3d)
  target_compile_options(cs_sim PRIVATE -fno-exceptions -fno-rtti -Wall -Wextra)
endif()
