cmake_minimum_required(VERSION 3.24)

project(cs_web LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(cs_sim_core STATIC
  sim/src/sim.cpp
)
target_include_directories(cs_sim_core PUBLIC sim/include)

if(EMSCRIPTEN)
  file(MAKE_DIRECTORY "${CMAKE_SOURCE_DIR}/public")

  add_executable(cs_game client/src/main.cpp)
  target_link_libraries(cs_game PRIVATE cs_sim_core)
  target_compile_options(cs_game PRIVATE -fno-exceptions -fno-rtti)
  target_compile_options(cs_sim_core PRIVATE -fno-exceptions -fno-rtti)
  target_link_options(cs_game PRIVATE
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    "-sFULL_ES3=1"
    "-sENVIRONMENT=web"
    "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sINITIAL_MEMORY=16777216"
    "-sSTACK_SIZE=1048576"
    "-sASSERTIONS=1"
  )
  set_target_properties(cs_game PROPERTIES
    OUTPUT_NAME game
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public"
  )
  add_custom_command(TARGET cs_game POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
      "${CMAKE_SOURCE_DIR}/web/index.html"
      "${CMAKE_SOURCE_DIR}/public/index.html"
  )
else()
  include(CTest)
  if(BUILD_TESTING)
    add_executable(cs_sim_tests sim/tests/sim_tests.cpp)
    target_link_libraries(cs_sim_tests PRIVATE cs_sim_core)
    add_test(NAME cs_sim_tests COMMAND cs_sim_tests)
  endif()
endif()
