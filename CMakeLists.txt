cmake_minimum_required(VERSION 3.24)

project(cs-web LANGUAGES C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Determinism: keep FP contraction off in the sim and box3d alike.
add_compile_options(-ffp-contract=off)

# Keep FetchContent downloads inside the build tree.
set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps" CACHE PATH "" FORCE)
include(FetchContent)

FetchContent_Declare(
  box3d
  GIT_REPOSITORY https://github.com/erincatto/box3d.git
  GIT_TAG d421e45c828f6f853a145f726f0b9425d31146eb # v0.1 initial release era, pinned
)
FetchContent_MakeAvailable(box3d)

add_subdirectory(sim)

if(NOT EMSCRIPTEN)
  enable_testing()
  add_subdirectory(sim/tests)
endif()
