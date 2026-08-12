#include "cs/sim.h"
#include "../src/state.h"
#include "../src/world.h"

#include <cmath>
#include <cstdio>

// Movement invariants, gunplay, match rules and determinism. Plain asserts, no
// framework.

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

cs::PlayerState& local_move() { return cs::state().players[cs::kLocalPlayer].move; }

void spawn_at_origin() { sim_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F); }

void run_ticks(int n, float forward, float strafe, std::uint32_t buttons) {
  for (int i = 0; i < n; ++i) {
    sim_step(forward, strafe, 0.0F, 0.0F, buttons, 0);
  }
}

/** True if any event this tick matches the kind. */
bool saw_event(std::uint32_t kind) {
  const cs::SimSnapshot* snap = sim_snapshot();
  for (std::uint32_t i = 0; i < snap->event_count; ++i) {
    if (snap->events[i].kind == kind) {
      return true;
    }
  }
  return false;
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
  local_move().velocity = {500.0F, 0.0F, 0.0F};
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0);
  const float expected = 1.7F * 221.0F * 0.65F;
  CHECK_NEAR(sim_snapshot()->speed_h, expected, 2.0F);
}

void test_jump_buffer_hops_on_landing() {
  // Tap jump while still falling: the buffer has to carry the press through to
  // the landing tick, which is the whole point of the bhop-ease change.
  sim_spawn(0.0F, cs::kHullHalfHeightStand + 70.0F, 0.0F, 0.0F);
  bool tapped = false;
  for (int i = 0; i < 64 && !tapped; ++i) {
    std::uint32_t buttons = 0;
    if (sim_snapshot()->origin.y < cs::kHullHalfHeightStand + 10.0F) {
      buttons = cs::ButtonJump;
      tapped = true;
      CHECK((sim_snapshot()->flags & cs::SnapOnGround) == 0U); // still airborne
    }
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, buttons, 0);
  }
  CHECK(tapped);

  int wait = 0;
  for (; wait < static_cast<int>(cs::kJumpBufferTicks) + 4; ++wait) {
    if (sim_snapshot()->velocity.y > 200.0F) {
      break;
    }
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0); // button already released
  }
  CHECK(wait < static_cast<int>(cs::kJumpBufferTicks) + 4);
  CHECK(sim_snapshot()->velocity.y > 200.0F);
}

void test_holding_jump_does_not_autohop() {
  // The buffer is armed on the press edge only. Holding space must give one
  // hop and then nothing, or the 1.6 tap-per-hop rhythm is gone.
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0);
  CHECK(sim_snapshot()->velocity.y > 200.0F);

  int extra_hops = 0;
  for (int i = 0; i < 192; ++i) {
    const float before = sim_snapshot()->velocity.y;
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump, 0); // never released
    if (before < 100.0F && sim_snapshot()->velocity.y > 200.0F) {
      ++extra_hops;
    }
  }
  CHECK(extra_hops == 0);
  CHECK((sim_snapshot()->flags & cs::SnapOnGround) != 0U);
}

void test_air_wishcap_no_gain() {
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  local_move().velocity = {0.0F, 0.0F, -200.0F}; // moving forward at 200
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

void test_air_unduck_blocked_by_roof() {
  // Ducked and airborne under the low roof (underside y=50): the standing hull
  // (top y+36) would overlap it, so releasing duck must keep us ducked instead
  // of unducking into the roof and getting stuck.
  sim_spawn(-350.0F, 20.0F, 0.0F, 0.0F);
  local_move().ducked = true;
  local_move().on_ground = false;
  local_move().velocity = {0.0F, 200.0F, 0.0F};
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0); // no duck button: wants to unduck
  CHECK((sim_snapshot()->flags & cs::SnapDucked) != 0U);
  const cs::PlayerState& p = local_move();
  const cs::Vec3 half = {cs::kHullHalfWidth,
                         p.ducked ? cs::kHullHalfHeightDuck : cs::kHullHalfHeightStand,
                         cs::kHullHalfWidth};
  CHECK(!cs::world_overlap_hull(p.origin, half));
}

void test_unstick_resolves_embedded_hull() {
  // Force the hull 6u into the floor; the unstick pass must pop it free and
  // the player must settle on the ground instead of freezing in place.
  sim_spawn(0.0F, 30.0F, 0.0F, 0.0F);
  for (int i = 0; i < 16; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
  }
  CHECK_NEAR(sim_snapshot()->origin.y, cs::kHullHalfHeightStand, 1.0F);
  CHECK((sim_snapshot()->flags & cs::SnapOnGround) != 0U);
  const cs::PlayerState& p = local_move();
  CHECK(!cs::world_overlap_hull(
      p.origin, {cs::kHullHalfWidth, cs::kHullHalfHeightStand, cs::kHullHalfWidth}));
}

/** Counts events of a kind over `ticks` of holding the given input. */
int count_events(int ticks, float forward, std::uint32_t buttons,
                 std::uint32_t kind, std::uint32_t* out_material = nullptr) {
  int seen = 0;
  for (int i = 0; i < ticks; ++i) {
    sim_step(forward, 0.0F, 0.0F, 0.0F, buttons, 0);
    const cs::SimSnapshot* snap = sim_snapshot();
    for (std::uint32_t e = 0; e < snap->event_count; ++e) {
      if (snap->events[e].kind != kind) {
        continue;
      }
      ++seen;
      if (out_material != nullptr) {
        *out_material = snap->events[e].material;
      }
    }
  }
  return seen;
}

void test_footsteps_and_silent_walk() {
  build_test_world();
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);

  // Running: one footfall per kStrideDistance of ground covered. 256 ticks at
  // the AK's 221 u/s is ~884u, so ~10 steps.
  const int running = count_events(256, 1.0F, 0, cs::EventStep);
  CHECK(running >= 8 && running <= 13);

  // +speed is silent. That trade is the entire reason the key exists, and it
  // is only real if the sim is what decides you made no sound.
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  CHECK(count_events(256, 1.0F, cs::ButtonWalk, cs::EventStep) == 0);

  // Standing still is silent too.
  CHECK(count_events(128, 0.0F, 0, cs::EventStep) == 0);

  // The step carries the surface under the feet: the floor here is concrete,
  // the 12u step at x 200..264 is wood.
  std::uint32_t material = 99U;
  sim_spawn(150.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, -3.14159265F * 0.5F);
  for (int i = 0; i < 256 && sim_snapshot()->origin.y < 12.0F + cs::kHullHalfHeightStand - 1.0F; ++i) {
    sim_step(1.0F, 0.0F, -3.14159265F * 0.5F, 0.0F, 0, 0);
  }
  CHECK_NEAR(sim_snapshot()->origin.y, 12.0F + cs::kHullHalfHeightStand, 1.0F);
  for (int i = 0; i < 256 && material == 99U; ++i) {
    sim_step(0.0F, 1.0F, -3.14159265F * 0.5F, 0.0F, 0, 0); // strafe along the step
    const cs::SimSnapshot* snap = sim_snapshot();
    for (std::uint32_t e = 0; e < snap->event_count; ++e) {
      if (snap->events[e].kind == cs::EventStep) {
        material = snap->events[e].material;
      }
    }
  }
  CHECK(material == cs::MaterialWood);
}

void test_landing_reports_a_hard_step() {
  build_test_world();
  sim_spawn(0.0F, cs::kHullHalfHeightStand + 200.0F, 0.0F, 0.0F);
  bool landed = false;
  for (int i = 0; i < 128 && !landed; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
    const cs::SimSnapshot* snap = sim_snapshot();
    for (std::uint32_t e = 0; e < snap->event_count; ++e) {
      if (snap->events[e].kind == cs::EventStep &&
          snap->events[e].result == cs::StepLand) {
        landed = true;
        // Reported at the feet, not the hull centre — that is where the client
        // puts the sound.
        CHECK_NEAR(snap->events[e].start.y, 0.0F, 1.5F);
      }
    }
  }
  CHECK(landed);

  // A plain hop touches down audibly but is not a *hard* landing: 45u of
  // jump comes back at ~268 u/s, under kLandingSpeed. And it makes noise even
  // while holding +speed — a silent bhop would defeat the point of walking.
  spawn_at_origin();
  run_ticks(32, 0.0F, 0.0F, 0);
  int hard = 0;
  int soft = 0;
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonJump | cs::ButtonWalk, 0);
  for (int i = 0; i < 96; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonWalk, 0);
    const cs::SimSnapshot* snap = sim_snapshot();
    for (std::uint32_t e = 0; e < snap->event_count; ++e) {
      if (snap->events[e].kind != cs::EventStep) {
        continue;
      }
      if (snap->events[e].result == cs::StepLand) ++hard;
      else ++soft;
    }
  }
  CHECK(hard == 0);
  CHECK(soft == 1);
}

void test_awp_zoom_cycles_and_slows() {
  spawn_at_origin();
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, cs::WeaponAwp);
  run_ticks(24, 0.0F, 0.0F, 0); // let the draw finish
  CHECK(sim_snapshot()->weapon == cs::WeaponAwp);
  CHECK_NEAR(sim_snapshot()->fov, cs::kBaseFov, 0.01F);

  const cs::WeaponDef& awp = cs::weapon_def(cs::WeaponAwp);
  const std::uint32_t kCycle[3] = {1U, 2U, 0U};
  for (std::uint32_t expected : kCycle) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonZoom, 0);
    CHECK(sim_snapshot()->zoom == expected);
    const float fov = expected == 0U ? cs::kBaseFov : awp.zoom_fov[expected - 1U];
    CHECK_NEAR(sim_snapshot()->fov, fov, 0.01F);
    run_ticks(4, 0.0F, 0.0F, 0); // release, so the next press is an edge
  }

  // Scoped, the AWP's 210 u/s drops by kZoomSpeedFactor.
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonZoom, 0);
  CHECK(sim_snapshot()->zoom == 1U);
  run_ticks(256, 1.0F, 0.0F, 0);
  CHECK_NEAR(sim_snapshot()->speed_h, 210.0F * cs::kZoomSpeedFactor, 2.0F);
  CHECK(sim_snapshot()->zoom == 1U); // moving does not break the scope

  // Reloading does: you cannot work a bolt down the scope.
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonFire, 0);
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, cs::ButtonReload, 0);
  CHECK(sim_snapshot()->zoom == 0U);
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, cs::WeaponAk47);
  run_ticks(24, 0.0F, 0.0F, 0);
}

void test_shooting_kills_a_bot() {
  build_test_world();
  spawn_at_origin();
  const std::uint32_t bot =
      sim_add_bot(0.0F, cs::kHullHalfHeightStand, -300.0F, 0.0F, cs::TeamNone, 0);
  CHECK(bot == 1U);
  run_ticks(32, 0.0F, 0.0F, 0);

  // Aim at chest height (~48u above feet, eye at 64u: slight downward pitch).
  bool saw_death = false;
  for (int i = 0; i < 96; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, -0.05F, cs::ButtonFire, 0);
    saw_death = saw_death || saw_event(cs::EventDeath);
  }
  const cs::SimSnapshot* snap = sim_snapshot();
  CHECK(snap->shots > 0);
  CHECK(snap->hits > 0);
  CHECK(snap->magazine < 30);
  CHECK(snap->kills > 0);
  CHECK(saw_death);
  CHECK(snap->players[1].deaths > 0);
  CHECK(snap->player_count == 2);
  build_test_world(); // clears the roster back to the local player
}

void test_bots_fight_back_and_you_respawn() {
  build_test_world();
  sim_add_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F, cs::TeamNone);
  sim_start_match(cs::ModeDeathmatch, 0, 2); // hard bots, placed by hand below
  const std::uint32_t bot =
      sim_add_bot(0.0F, cs::kHullHalfHeightStand, -420.0F, 0.0F, cs::TeamNone, 2);
  CHECK(bot == 1U);

  bool damaged = false;
  for (int i = 0; i < 900 && !damaged; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
    damaged = sim_snapshot()->health < cs::kPlayerHealth;
  }
  CHECK(damaged);

  // Stand there long enough and it finishes the job; then we come back.
  bool died = false;
  for (int i = 0; i < 1800 && !died; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
    died = sim_snapshot()->deaths > 0;
  }
  CHECK(died);
  for (int i = 0; i < static_cast<int>(cs::kRespawnTicks) + 8; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
  }
  CHECK((sim_snapshot()->flags & cs::SnapAlive) != 0U);
  CHECK_NEAR(sim_snapshot()->health, cs::kPlayerHealth, 0.01F);
  CHECK(sim_snapshot()->players[1].kills > 0);

  sim_create();
  build_test_world();
}

void test_loadout_survives_death() {
  // Picking the AWP and then dying used to hand you a rifle back, so the scope
  // had to be re-selected every single life.
  build_test_world();
  sim_add_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F, cs::TeamNone);
  sim_start_match(cs::ModeDeathmatch, 0, 0);
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, cs::WeaponAwp);
  run_ticks(24, 0.0F, 0.0F, 0);
  CHECK(sim_snapshot()->weapon == cs::WeaponAwp);

  cs::state().players[cs::kLocalPlayer].health = 1.0F;
  const std::uint32_t bot =
      sim_add_bot(0.0F, cs::kHullHalfHeightStand, -300.0F, 0.0F, cs::TeamNone, 2);
  CHECK(bot == 1U);
  for (int i = 0; i < 1200 && sim_snapshot()->deaths == 0; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
  }
  CHECK(sim_snapshot()->deaths > 0);
  for (int i = 0; i < static_cast<int>(cs::kRespawnTicks) + 8; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, 0);
  }
  CHECK((sim_snapshot()->flags & cs::SnapAlive) != 0U);
  CHECK(sim_snapshot()->weapon == cs::WeaponAwp);
  CHECK(sim_snapshot()->magazine == cs::weapon_def(cs::WeaponAwp).magazine);

  // A match restart keeps it too, but the scope always comes back stowed.
  sim_start_match(cs::ModeDeathmatch, 0, 0);
  CHECK(sim_snapshot()->weapon == cs::WeaponAwp);
  CHECK(sim_snapshot()->zoom == 0U);

  sim_create();
  build_test_world();
}

void test_team_mode_has_no_friendly_fire() {
  build_test_world();
  sim_add_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F, cs::TeamNone);
  sim_start_match(cs::ModeTeam, 0, 0);
  // Index 0 is CT; add a CT bot directly in the line of fire.
  const std::uint32_t friendly =
      sim_add_bot(0.0F, cs::kHullHalfHeightStand, -300.0F, 0.0F, cs::TeamCt, 0);
  CHECK(friendly == 1U);
  sim_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, 0.0F, 0.0F);
  run_ticks(32, 0.0F, 0.0F, 0);
  for (int i = 0; i < 64; ++i) {
    sim_step(0.0F, 0.0F, 0.0F, -0.05F, cs::ButtonFire, 0);
  }
  CHECK(sim_snapshot()->hits == 0);
  CHECK_NEAR(sim_snapshot()->players[1].health, cs::kPlayerHealth, 0.01F);

  sim_create();
  build_test_world();
}

// A ~26.6-degree ramp brush rising 1u per 2u along -Z (the yaw-0 forward
// direction), from z=-600 (y=0) to z=-1200 (y=300), spanning x -64..64.
// Planes are (nx, ny, nz, d) with the interior at dot(n, x) <= d.
void add_ramp_brush() {
  // Surface satisfies 2y + z = -600, so the outward normal is (0, 2, 1).
  const float inv = 1.0F / std::sqrt(5.0F);
  const float planes[] = {
      0.0F, 2.0F * inv, inv, -600.0F * inv, // slope face, through (*, 0, -600)
      0.0F,  0.0F, 1.0F,  -600.0F,          // +Z cap
      0.0F,  0.0F, -1.0F, 1200.0F,          // -Z cap
      0.0F, -1.0F, 0.0F,  0.0F,             // bottom at y = 0
      1.0F,  0.0F, 0.0F,  64.0F,            // +X
      -1.0F, 0.0F, 0.0F,  64.0F,            // -X
  };
  CHECK(sim_add_brush(planes, 6, cs::MaterialConcrete) == 1);
}

void test_ramp_is_walkable() {
  // Non-axis-aligned geometry had no coverage before the brush trace landed.
  sim_world_reset();
  sim_add_box(-1024.0F, -16.0F, -1400.0F, 1024.0F, 0.0F, 1024.0F, cs::MaterialConcrete);
  add_ramp_brush();
  sim_world_finalize();

  sim_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, -560.0F, 0.0F);
  run_ticks(100, 1.0F, 0.0F, 0); // yaw 0 is -Z, straight up the slope
  const cs::SimSnapshot* snap = sim_snapshot();
  // Climbed the slope rather than stalling at its foot.
  CHECK(snap->origin.z < -750.0F);
  CHECK(snap->origin.y > cs::kHullHalfHeightStand + 30.0F);
  CHECK((snap->flags & cs::SnapOnGround) != 0U);
  // Still moving, i.e. the slope did not wedge the hull.
  CHECK(snap->speed_h > 50.0F);
  // Riding the surface, not floating above it or sunk into it. A box hull on a
  // slope contacts at its lower edge, so the centre sits higher than the
  // surface directly beneath it: contact is where 2y + z equals the plane
  // constant plus the hull's support along the (0, 2, 1) normal, 2*36 + 1*16.
  const float support = 2.0F * cs::kHullHalfHeightStand + cs::kHullHalfWidth;
  CHECK_NEAR(snap->origin.y, (support - 600.0F - snap->origin.z) * 0.5F, 0.5F);

  build_test_world(); // restore the shared world for later tests
}

void test_brush_rejects_degenerate_input() {
  sim_world_reset();
  // Three planes cannot bound a solid.
  const float open[] = {
      1.0F, 0.0F, 0.0F, 10.0F, 0.0F, 1.0F, 0.0F, 10.0F, 0.0F, 0.0F, 1.0F, 10.0F,
  };
  CHECK(sim_add_brush(open, 3, cs::MaterialConcrete) == 0);
  // Six planes that face outward with no common interior enclose nothing.
  const float inverted[] = {
      -1.0F, 0.0F, 0.0F, -10.0F, 1.0F, 0.0F,  0.0F, -10.0F,
      0.0F, -1.0F, 0.0F, -10.0F, 0.0F, 1.0F,  0.0F, -10.0F,
      0.0F, 0.0F, -1.0F, -10.0F, 0.0F, 0.0F,  1.0F, -10.0F,
  };
  CHECK(sim_add_brush(inverted, 6, cs::MaterialConcrete) == 0);
  build_test_world();
}

void test_trace_ray_abi() {
  build_test_world();
  float hit[8] = {};
  // Straight at the 40u wall that starts at x = 400.
  CHECK(sim_trace_ray(0.0F, 20.0F, 0.0F, 800.0F, 20.0F, 0.0F, hit) == 1);
  CHECK_NEAR(hit[1], 400.0F, 1.0F);   // impact x
  CHECK_NEAR(hit[4], -1.0F, 0.01F);   // normal points back along -X
  CHECK(hit[7] == static_cast<float>(cs::MaterialConcrete));
  // The 12u step at x 200..264 is wood; the client picks impact sounds off this.
  CHECK(sim_trace_ray(0.0F, 6.0F, 0.0F, 800.0F, 6.0F, 0.0F, hit) == 1);
  CHECK(hit[7] == static_cast<float>(cs::MaterialWood));
  // Over the top of the wall: clean miss.
  CHECK(sim_trace_ray(0.0F, 200.0F, 0.0F, 800.0F, 200.0F, 0.0F, hit) == 0);
}

// A plank, a sheet of steel and a concrete wall, each on its own lane so a
// bullet meets exactly one of them.
void build_penetration_world() {
  sim_world_reset();
  sim_add_box(-1024.0F, -16.0F, -1024.0F, 1024.0F, 0.0F, 1024.0F, cs::MaterialConcrete);
  sim_add_box(200.0F, 0.0F, -64.0F, 216.0F, 128.0F, 64.0F, cs::MaterialWood);      // 16u
  sim_add_box(200.0F, 0.0F, 200.0F, 216.0F, 128.0F, 328.0F, cs::MaterialMetal);    // 16u
  sim_add_box(200.0F, 0.0F, -328.0F, 232.0F, 128.0F, -200.0F, cs::MaterialConcrete); // 32u
  sim_world_finalize();
}

/**
 * Fires one round down +X from (0, eye, lane) and reports its shot event.
 *
 * The first round only: the spray pattern walks later shots up into the head
 * box, and a headshot's x4 would swamp the damage the wall is supposed to cost.
 */
cs::SimEvent shoot_lane(float lane, std::uint32_t weapon) {
  const float yaw = -3.14159265F * 0.5F; // +X
  sim_spawn(0.0F, cs::kHullHalfHeightStand + 2.0F, lane, yaw);
  sim_step(0.0F, 0.0F, yaw, 0.0F, 0, weapon);
  run_ticks(48, 0.0F, 0.0F, 0); // settle on the floor and finish the draw

  for (int i = 0; i < 64; ++i) {
    sim_step(0.0F, 0.0F, yaw, -0.04F, cs::ButtonFire, 0);
    const cs::SimSnapshot* snap = sim_snapshot();
    for (std::uint32_t e = 0; e < snap->event_count; ++e) {
      if (snap->events[e].kind == cs::EventShot &&
          snap->events[e].result != cs::ShotDry) {
        return snap->events[e];
      }
    }
  }
  CHECK(false); // never got a round off
  return {};
}

void test_wallbang_penetration() {
  build_penetration_world();

  // Thickness comes straight off the trace: one clip, both faces.
  const cs::TraceResult plank =
      cs::world_trace_ray({0.0F, 64.0F, 0.0F}, {1000.0F, 64.0F, 0.0F});
  CHECK(plank.hit);
  CHECK_NEAR(plank.fraction * 1000.0F, 200.0F, 0.1F);
  CHECK_NEAR((plank.exit_fraction - plank.fraction) * 1000.0F, 16.0F, 0.1F);
  // A ray crossing the same plank at 45 degrees passes through more of it, and
  // that is what makes corner-banging a crate work.
  const cs::TraceResult angled =
      cs::world_trace_ray({0.0F, 64.0F, 0.0F}, {1000.0F, 64.0F, 1000.0F});
  const float diagonal = std::sqrt(2.0F) * 1000.0F;
  CHECK_NEAR((angled.exit_fraction - angled.fraction) * diagonal, 16.0F * std::sqrt(2.0F), 0.2F);

  // 16u of wood costs the AK 5.6 of its 26: through, and still lethal.
  sim_add_bot(400.0F, cs::kHullHalfHeightStand, 0.0F, 0.0F, cs::TeamNone, 0.0F);
  const cs::SimEvent wood = shoot_lane(0.0F, cs::WeaponAk47);
  CHECK(wood.result == cs::ShotHit || wood.result == cs::ShotKill);
  CHECK(wood.damage > 15.0F && wood.damage < 30.0F);

  // The same 16u in steel costs 27.2, which the AK cannot pay.
  build_penetration_world();
  sim_add_bot(400.0F, cs::kHullHalfHeightStand, 264.0F, 0.0F, cs::TeamNone, 0.0F);
  const cs::SimEvent steel = shoot_lane(264.0F, cs::WeaponAk47);
  CHECK(steel.result == cs::ShotWorld);
  CHECK(steel.material == cs::MaterialMetal);
  CHECK_NEAR(steel.end.x, 200.0F, 2.0F); // stopped at the near face
  CHECK(sim_snapshot()->players[1].health == cs::kPlayerHealth);

  // 32u of concrete is the AWP's alone, and it arrives with a third of its
  // budget left, so a wallbang is never a free kill.
  build_penetration_world();
  sim_add_bot(400.0F, cs::kHullHalfHeightStand, -264.0F, 0.0F, cs::TeamNone, 0.0F);
  CHECK(shoot_lane(-264.0F, cs::WeaponAk47).result == cs::ShotWorld);
  build_penetration_world();
  sim_add_bot(400.0F, cs::kHullHalfHeightStand, -264.0F, 0.0F, cs::TeamNone, 0.0F);
  const cs::SimEvent awp = shoot_lane(-264.0F, cs::WeaponAwp);
  CHECK(awp.result == cs::ShotHit || awp.result == cs::ShotKill);
  CHECK(awp.damage > 20.0F && awp.damage < 60.0F); // 115 base, cut by the wall

  build_test_world();
  sim_step(0.0F, 0.0F, 0.0F, 0.0F, 0, cs::WeaponAk47);
  run_ticks(24, 0.0F, 0.0F, 0);
}

void test_determinism() {
  // Includes bots: their scans, aim error and goal picks all draw from the sim
  // rng, so a divergence anywhere in bots.cpp shows up here.
  auto scenario = [] {
    sim_create();
    build_test_world();
    sim_add_spawn(0.0F, 38.0F, 0.0F, 0.0F, cs::TeamNone);
    sim_add_spawn(-400.0F, 38.0F, 300.0F, 1.0F, cs::TeamNone);
    sim_add_spawn(500.0F, 38.0F, -200.0F, -1.0F, cs::TeamNone);
    sim_start_match(cs::ModeDeathmatch, 3, 1);
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
  test_jump_buffer_hops_on_landing();
  test_holding_jump_does_not_autohop();
  test_air_wishcap_no_gain();
  test_step_up_and_wall_block();
  test_duck_lowers_hull_and_blocks_unduck();
  test_air_unduck_blocked_by_roof();
  test_unstick_resolves_embedded_hull();
  test_footsteps_and_silent_walk();
  test_landing_reports_a_hard_step();
  test_awp_zoom_cycles_and_slows();
  test_ramp_is_walkable();
  test_brush_rejects_degenerate_input();
  test_trace_ray_abi();
  test_wallbang_penetration();
  test_shooting_kills_a_bot();
  test_bots_fight_back_and_you_respawn();
  test_loadout_survives_death();
  test_team_mode_has_no_friendly_fire();
  test_determinism();

  if (g_failures == 0) {
    std::printf("all sim tests passed\n");
    return 0;
  }
  std::printf("%d failure(s)\n", g_failures);
  return 1;
}
