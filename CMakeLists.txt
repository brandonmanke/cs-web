cmake_minimum_required(VERSION 3.24)

project(cs-web LANGUAGES C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Determinism: no FP contraction, so native and wasm agree bit for bit.
add_compile_options(-ffp-contract=off)

add_subdirectory(sim)

if(NOT EMSCRIPTEN)
  enable_testing()
  add_subdirectory(sim/tests)
endif()
