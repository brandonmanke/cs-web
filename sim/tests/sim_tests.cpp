#include "cs/sim.h"
#include "../src/state.h"

#include <cmath>
#include <cstdio>

// Movement invariants + determinism. Plain asserts, no framework.

namespace {

int g_failures = 0;

#define CHECK(cond)                                                          \
  do {                                                                       \
    if (!(cond)) {                                                           \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);            \
      ++g_failures;                                                          \
    }                                                                        \
  } while (0)

#define CHECK_NEAR(a, b, tol)                                                \
  do {                                                                       \
    const float check_a = (a);                                               \
    const float check_b = (b);                                               \
    if (std::fabs(check_a - check_b) > (tol)) {                              \
      std::printf("FAIL %s:%d: %s=%f vs %s=%f (tol %f)\n", __FILE__,         \
                  __LINE__, #a, static_cast<double>(check_a), #b,            \
                  static_cast<double>(check_b), static_cast<double>(tol));   \
      ++g_failures;                                                          \
    }                                                                        \
  } while (0)

// Flat floor + a 12u step + a 40u wall + a headroom ceiling area.
void build_test_world() {
  sim_world_reset();
  sim_add_box(-1024.0F, -16.0F, -1024.0F, 1024.0F, 0.0F, 1024.0F, cs::MaterialConcrete);
  sim_add_box(200.0F, 0.0F, -64.0F, 264.0F, 12.0F, 64.0F, cs::MaterialWood); // step
  sim_add_box(400.0F, 0.0F, -64.0F, 432.0F, 40.0F, 64.0F, cs::MaterialConcrete); // wall
  sim_add_box(-400.0F, 50.0F, -64.0F, -300.0F, 60.0F, 64.0F, cs::MaterialWood); // low roof
  sim_world_finalize();
}

void spawn_at_origin() { sim_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F); }

void run_ticks(int n, float forward, float strafe, std::uint32_t buttons) {
  for (int i = 0; i < n; ++i) {
    sim_step(forward, strafe, 0.0F, 0.0F, buttons, 0);
  }
}

void test_ground_speed_cap() {
  spawn_at_origin();
  run_ticks(256, 1.0F, 0.0F, 0); // 4 s of holding forward
  const cs::SimSnapshot* snap = sim_snapshot();
  // AK-47 is the default weapon: 221 u/s cap.
  CHECK_NEAR(snap->speed_h, 221.0F, 2.0F);
  CHECK((snap->flags & cs::SnapOnGround) != 0U);
}

void test_jump_height() {
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0); // settle on the floor
  const float start_y = sim_snapshot()->origin.y;
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0);
  float apex = start_y;
  for (int i = 0; i < 96; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
    if (sim_snapshot()->origin.y > apex) {
      apex = sim_snapshot()->origin.y;
    }
  }
  // 45u jump minus discrete-integration undershoot; generous tolerance.
  CHECK_NEAR(apex - start_y, 45.0F, 3.0F);
  // And we must land again.
  run_ticks(64, 0.0F, 0.0F, 0);
  CHECK((sim_snapshot()->flags & cs::SnapOnGround) != 0U);
}

void test_bhop_speed_cap() {
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  // Inject an illegal 500 u/s and jump: PreventMegaBunnyJumping should clamp
  // to (1.7 * 221 / 500) * 0.65 * 500 = 244.2 u/s (AK default weapon).
  cs::state().player.velocity = {500.0F, 0.0F, 0.0F};
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0);
  const float expected = 1.7F * 221.0F * 0.65F;
  CHECK_NEAR(sim_snapshot()->speed_h, expected, 2.0F);
}

void test_air_wishcap_no_gain() {
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  cs::state().player.velocity = {0.0F, 0.0F, -200.0F}; // moving forward at 200
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0);
  const float before = sim_snapshot()->speed_h;
  // Hold pure forward in the air: the 30 u/s wishcap means no meaningful gain.
  for (int i = 0; i < 20 && (sim_snapshot()->flags & cs::SnapOnGround) == 0U; ++i) {
    sim_step(1.0F, 0.0F, 0.0F, 0.0F, 0, 0);
  }
  CHECK(sim_snapshot()->speed_h <= before + 1.0F);
}

void test_step_up_and_wall_block() {
  spawn_at_origin();
  sim_spawn(150.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, -3.14159265F * 0.5F);
  // Face +X (yaw -90deg): walk onto the 12u step and sample while on it.
  for (int i = 0; i < 96 && sim_snapshot()->origin.x < 230.0F; ++i) {
    sim_step(1.0F, 0.0F, -3.14159265F * 0.5F, 0.0F, 0, 0);
  }
  const cs::SimSnapshot* snap = sim_snapshot();
  CHECK(snap->origin.x > 210.0F && snap->origin.x < 264.0F); // on the step
  CHECK_NEAR(snap->origin.y, 12.0F + cs::kHullHalfHeightStand, 1.0F);
  // Keep walking into the 40u wall: blocked, never climbs it.
  for (int i = 0; i < 128; ++i) {
    sim_step(1.0F, 0.0F, -3.14159265F * 0.5F, 0.0F, 0, 0);
  }
  CHECK(sim_snapshot()->origin.x < 400.0F - cs::kHullHalfWidth + 1.0F);
  CHECK(sim_snapshot()->origin.y < 40.0F); // still on the step, not on the wall
}

void test_duck_lowers_hull_and_blocks_unduck() {
  // Start clear of the roof (which spans x -400..-300 at y 50..60).
  sim_spawn(-200.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F);
  run_ticks(32, 0.0F, 0.0F, 0);
  run_ticks(32, 0.0F, 0.0F, cs::ButtonDuck);
  CHECK((sim_snapshot()->flags & cs::SnapDucked) != 0U);
  CHECK_NEAR(sim_snapshot()->origin.y, cs::kHullHalfHeightDuck, 1.0F);
  // Duck-walk -X under the roof (yaw +90deg faces -X).
  const float yaw = 3.14159265F * 0.5F;
  for (int i = 0; i < 600 && sim_snapshot()->origin.x > -350.0F; ++i) {
    sim_step(1.0F, 0.0F, yaw, 0.0F, cs::ButtonDuck, 0);
  }
  CHECK(sim_snapshot()->origin.x <= -350.0F);
  // A 72u hull can't stand under the 50u roof: releasing duck stays ducked.
  run_ticks(16, 0.0F, 0.0F, 0);
  CHECK((sim_snapshot()->flags & cs::SnapDucked) != 0U);
  // Walk +X back out and unduck.
  for (int i = 0; i < 600 && sim_snapshot()->origin.x < -260.0F; ++i) {
    sim_step(1.0F, 0.0F, -yaw, 0.0F, 0, 0);
  }
  run_ticks(16, 0.0F, 0.0F, 0);
  CHECK((sim_snapshot()->flags & cs::SnapDucked) == 0U);
}

void test_shooting_hits_target() {
  spawn_at_origin();
  sim_add_target(0.0F, 0.0F, -300.0F, 0.0F, 0.0F, 0.0F);
  run_ticks(32, 0.0F, 0.0F, 0);
  // Aim at chest height (~48u above feet, eye at 64u: slight downward pitch).
  const float pitch = -0.05F;
  int fired = 0;
  for (int i = 0; i < 64; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, pitch, cs::ButtonFire, 0);
    ++fired;
  }
  const cs::SimSnapshot* snap = sim_snapshot();
  CHECK(snap->shots > 0);
  CHECK(snap->hits > 0);
  CHECK(snap->magazine < 30);
  CHECK(snap->last_shot.sequence > 0);
}

void test_determinism() {
  auto scenario = [] {
    sim_create();
    build_test_world();
    spawn_at_origin();
    sim_add_target(100.0F, 0.0F, -400.0F, 0.0F, 200.0F, 60.0F);
    for (int i = 0; i < 600; ++i) {
      const float f = (i % 128) < 64 ? 1.0F : -0.5F;
      const float s = (i % 64) < 32 ? 1.0F : -1.0F;
      const float yaw = static_cast<float>(i) * 0.01F;
      std::uint32_t buttons = 0;
      if (i % 96 == 0) buttons |= cs::ButtonJump;
      if (i % 7 == 0) buttons |= cs::ButtonFire;
      if ((i % 200) > 150) buttons |= cs::ButtonDuck;
      sim_step(f, s, yaw, -0.1F, buttons, 0);
    }
    return cs::state_hash(cs::state());
  };
  const std::uint64_t first = scenario();
  const std::uint64_t second = scenario();
  CHECK(first == second);
  CHECK(first != 0);
}

} // namespace

int main() {
  sim_create();
  build_test_world();

  test_ground_speed_cap();
  test_jump_height();
  test_bhop_speed_cap();
  test_air_wishcap_no_gain();
  test_step_up_and_wall_block();
  test_duck_lowers_hull_and_blocks_unduck();
  test_shooting_hits_target();
  test_determinism();

  if (g_failures == 0) {
    std::printf("all sim tests passed\n");
    return 0;
  }
  std::printf("%d failure(s)\n", g_failures);
  return 1;
}
