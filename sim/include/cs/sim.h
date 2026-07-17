#pragma once

#include <cstdint>

namespace cs {

inline constexpr std::uint32_t kSimApiVersion = 1;
inline constexpr float kTickSeconds = 1.0F / 64.0F;

struct SimSnapshot {
  std::uint32_t api_version;
  std::uint32_t tick;
  float player_x;
  float player_y;
  float player_z;
};

}  // namespace cs

extern "C" {

std::uint32_t sim_create();
void sim_step(float forward, float strafe);
const cs::SimSnapshot* sim_snapshot();

}
