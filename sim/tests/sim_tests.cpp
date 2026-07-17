#include "cs/sim.h"

#include <cmath>
#include <cstdio>

namespace {

bool near(float actual, float expected) {
  return std::fabs(actual - expected) < 0.0001F;
}

}  // namespace

int main() {
  if (sim_create() != cs::kSimApiVersion) {
    std::fputs("sim_create returned an unexpected API version\n", stderr);
    return 1;
  }

  for (int tick = 0; tick < 64; ++tick) {
    sim_step(1.0F, 0.0F);
  }

  const cs::SimSnapshot& snapshot = *sim_snapshot();
  if (snapshot.tick != 64 || !near(snapshot.player_z, -96.0F)) {
    std::fprintf(
      stderr,
      "unexpected snapshot: tick=%u z=%f\n",
      snapshot.tick,
      snapshot.player_z
    );
    return 1;
  }

  std::puts("cs_sim M0 native test passed");
  return 0;
}
