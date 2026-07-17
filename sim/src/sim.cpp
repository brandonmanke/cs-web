#include "cs/sim.h"

namespace {

cs::SimSnapshot state{};

}  // namespace

extern "C" std::uint32_t sim_create() {
  state = {
    .api_version = cs::kSimApiVersion,
    .tick = 0,
    .player_x = 0.0F,
    .player_y = 0.0F,
    .player_z = 0.0F,
  };
  return cs::kSimApiVersion;
}

extern "C" void sim_step(float forward, float strafe) {
  constexpr float kSpikeSpeed = 96.0F;
  state.player_x += strafe * kSpikeSpeed * cs::kTickSeconds;
  state.player_z -= forward * kSpikeSpeed * cs::kTickSeconds;
  ++state.tick;
}

extern "C" const cs::SimSnapshot* sim_snapshot() {
  return &state;
}
