#pragma once

#include <GLES3/gl3.h>

#include <array>
#include <cstddef>
#include <cstdint>

namespace cs::client {

struct RuntimeSurface {
  GLuint texture = 0;
  GLsizei index_count = 0;
  std::uint32_t first_index = 0;
};

struct RuntimeModel {
  static constexpr std::size_t kMaxSurfaces = 16;

  GLuint vao = 0;
  GLuint vertex_buffer = 0;
  GLuint index_buffer = 0;
  GLsizei index_count = 0;
  std::array<RuntimeSurface, kMaxSurfaces> surfaces{};
  std::uint32_t surface_count = 0;
  float minimum[3]{};
  float maximum[3]{};
};

bool load_glb_model(const char* path, RuntimeModel& model);
void draw_model(const RuntimeModel& model);

}  // namespace cs::client
