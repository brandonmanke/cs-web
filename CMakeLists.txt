cmake_minimum_required(VERSION 3.24)

project(cs_web LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(cs_sim_core STATIC
  sim/src/sim.cpp
)
target_include_directories(cs_sim_core PUBLIC sim/include)

add_library(cs_net_core STATIC
  net/src/net_protocol.cpp
  net/src/client_prediction.cpp
  net/src/interpolation.cpp
)
target_include_directories(cs_net_core PUBLIC net/include)
target_link_libraries(cs_net_core PUBLIC cs_sim_core)

if(EMSCRIPTEN)
  file(MAKE_DIRECTORY "${CMAKE_SOURCE_DIR}/public")

  add_executable(cs_game
    client/src/main.cpp
    client/src/runtime_model.cpp
  )
  target_include_directories(cs_game PRIVATE
    client/src
    third_party/cgltf
    third_party/stb
  )
  target_link_libraries(cs_game PRIVATE cs_sim_core openal)
  target_compile_options(cs_game PRIVATE -fno-exceptions -fno-rtti)
  target_compile_options(cs_sim_core PRIVATE -fno-exceptions -fno-rtti)
  target_link_options(cs_game PRIVATE
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    "-sFULL_ES3=1"
    "-sENVIRONMENT=web"
    "-sFORCE_FILESYSTEM=1"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sINITIAL_MEMORY=67108864"
    "-sSTACK_SIZE=1048576"
    "-sASSERTIONS=1"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/assets/models/psx/weapons/ak47/ak47.glb@/assets/ak47.glb"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/assets/models/psx/weapons/glock/glock.glb@/assets/glock.glb"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/assets/models/psx/weapons/knife/knife.glb@/assets/knife.glb"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/assets/models/psx/weapons/m4a1/m4a1.glb@/assets/m4a1.glb"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/assets/models/psx/weapons/mp5/mp5.glb@/assets/mp5.glb"
  )
  set_target_properties(cs_game PROPERTIES
    OUTPUT_NAME game
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public"
  )
  add_custom_command(
    OUTPUT "${CMAKE_SOURCE_DIR}/public/index.html"
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
      "${CMAKE_SOURCE_DIR}/web/index.html"
      "${CMAKE_SOURCE_DIR}/public/index.html"
    DEPENDS "${CMAKE_SOURCE_DIR}/web/index.html"
  )
  add_custom_target(cs_web_shell ALL
    DEPENDS "${CMAKE_SOURCE_DIR}/public/index.html"
  )
else()
  add_library(cs_server_core STATIC
    server/src/server.cpp
  )
  target_include_directories(cs_server_core PUBLIC server/include)
  target_link_libraries(cs_server_core PUBLIC cs_net_core)

  add_executable(cs_server server/src/main.cpp)
  target_link_libraries(cs_server PRIVATE cs_server_core)

  include(CTest)
  if(BUILD_TESTING)
    add_executable(cs_sim_tests sim/tests/sim_tests.cpp)
    target_link_libraries(cs_sim_tests PRIVATE cs_sim_core)
    add_test(NAME cs_sim_tests COMMAND cs_sim_tests)

    add_executable(cs_server_tests server/tests/server_tests.cpp)
    target_link_libraries(cs_server_tests PRIVATE cs_server_core)
    add_test(NAME cs_server_tests COMMAND cs_server_tests)
  endif()
endif()
