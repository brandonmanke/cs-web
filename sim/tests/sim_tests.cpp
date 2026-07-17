#include "cs/sim.h"

#include <cmath>
#include <cstdio>

namespace {

int failures = 0;

void check(bool condition, const char* message) {
  if (condition) return;
  std::fprintf(stderr, "FAIL: %s\n", message);
  ++failures;
}

cs::Simulation flat_world() {
  cs::Simulation simulation{};
  cs::initialize(simulation);
  cs::select_weapon(simulation, cs::WeaponKnife, true);
  cs::clear_targets(simulation);
  cs::clear_world(simulation);
  cs::add_solid(
    simulation,
    {-4096.0F, -16.0F, -4096.0F},
    {4096.0F, 0.0F, 4096.0F}
  );
  cs::set_player(simulation, {0.0F, cs::kStandingHalfHeight, 0.0F});
  return simulation;
}

cs::Simulation target_world(bool with_wood_wall) {
  cs::Simulation simulation = flat_world();
  cs::select_weapon(simulation, cs::WeaponAk47, true);
  cs::clear_targets(simulation);
  cs::add_target(simulation, {0.0F, 0.0F, -200.0F}, 0.0F, 0.0F, 0.0F);
  if (with_wood_wall) {
    cs::add_solid(
      simulation,
      {-48.0F, 0.0F, -100.0F},
      {48.0F, 96.0F, -92.0F},
      cs::MaterialWood
    );
  }
  return simulation;
}

void run_ticks(cs::Simulation& simulation, int count, cs::InputCommand command) {
  for (int tick = 0; tick < count; ++tick) cs::step(simulation, command);
}

float horizontal_speed(const cs::Simulation& simulation) {
  const cs::Vec3 velocity = simulation.player.velocity;
  return std::sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

void test_ground_move_and_counter_strafe() {
  cs::Simulation simulation = flat_world();
  run_ticks(simulation, 128, {.forward = 1.0F});
  check(
    std::fabs(horizontal_speed(simulation) - cs::kRunSpeed) < 0.1F,
    "ground acceleration reaches the 250 u/s run speed"
  );

  int stop_ticks = 0;
  while (simulation.player.velocity.z < 0.0F && stop_ticks < 20) {
    cs::step(simulation, {.forward = -1.0F});
    ++stop_ticks;
  }
  cs::step(simulation, {});
  check(stop_ticks <= 10, "counter-strafing crosses zero within ten 64 Hz ticks");
  check(horizontal_speed(simulation) < 1.0F, "releasing at the counter-strafe crossing produces a full stop");
}

void test_air_strafe_gain() {
  cs::Simulation forward_sim{};
  cs::initialize(forward_sim);
  cs::clear_world(forward_sim);
  cs::set_player(forward_sim, {0.0F, 256.0F, 0.0F}, {0.0F, 0.0F, -250.0F});
  cs::Simulation strafe_sim = forward_sim;

  cs::step(forward_sim, {.forward = 1.0F});
  cs::step(strafe_sim, {.strafe = 1.0F});
  check(
    horizontal_speed(strafe_sim) > horizontal_speed(forward_sim) + 1.0F,
    "perpendicular air strafe gains speed while W-only air movement does not"
  );
}

void test_jump_fatigue_and_bhop_cap() {
  cs::Simulation simulation = flat_world();
  cs::step(simulation, {.buttons = cs::ButtonJump});
  float first_peak = simulation.player.origin.y;
  bool left_ground = !simulation.player.on_ground;
  for (int tick = 0; tick < 128 && (left_ground || !simulation.player.on_ground); ++tick) {
    cs::step(simulation, {});
    first_peak = std::max(first_peak, simulation.player.origin.y);
    left_ground = left_ground || !simulation.player.on_ground;
    if (left_ground && simulation.player.on_ground) break;
  }

  cs::step(simulation, {.buttons = cs::ButtonJump});
  float second_peak = simulation.player.origin.y;
  for (int tick = 0; tick < 128 && !simulation.player.on_ground; ++tick) {
    cs::step(simulation, {});
    second_peak = std::max(second_peak, simulation.player.origin.y);
  }
  check(second_peak + 2.0F < first_peak, "jump fatigue makes the immediate second hop lower");

  cs::Simulation cap_sim = flat_world();
  cap_sim.player.velocity.x = 600.0F;
  cs::step(cap_sim, {.buttons = cs::ButtonJump});
  check(
    horizontal_speed(cap_sim) <= cs::kRunSpeed * 1.7F * 0.65F + 0.1F,
    "mega-bhop prevention reduces speed after crossing the 1.7x threshold"
  );
}

void test_duck_wall_and_step_collision() {
  cs::Simulation duck_sim = flat_world();
  cs::step(duck_sim, {.buttons = cs::ButtonDuck});
  check(duck_sim.player.ducked, "duck input selects the short hull");
  check(std::fabs(duck_sim.player.origin.y - cs::kDuckedHalfHeight) < 0.1F, "ground duck keeps feet planted");

  cs::Simulation wall_sim = flat_world();
  cs::add_solid(wall_sim, {100.0F, 0.0F, -128.0F}, {116.0F, 144.0F, 128.0F});
  run_ticks(wall_sim, 128, {.strafe = 1.0F});
  check(wall_sim.player.origin.x <= 84.01F, "standing hull stops sixteen units from a wall");

  cs::Simulation step_sim = flat_world();
  cs::add_solid(step_sim, {-48.0F, 0.0F, -16.0F}, {48.0F, 16.0F, 48.0F});
  cs::set_player(step_sim, {0.0F, cs::kStandingHalfHeight, 96.0F});
  float max_height = step_sim.player.origin.y;
  for (int tick = 0; tick < 64; ++tick) {
    cs::step(step_sim, {.forward = 1.0F});
    max_height = std::max(max_height, step_sim.player.origin.y);
  }
  check(max_height >= 51.9F, "ground movement climbs a sixteen-unit step");
  check(step_sim.player.origin.z < -16.0F, "step movement continues across the obstacle");

  cs::Simulation duck_jump_sim = flat_world();
  cs::add_solid(
    duck_jump_sim,
    {-64.0F, 0.0F, -40.0F},
    {64.0F, 58.0F, 40.0F}
  );
  cs::set_player(
    duck_jump_sim,
    {0.0F, cs::kStandingHalfHeight, 140.0F},
    {0.0F, 0.0F, -cs::kRunSpeed}
  );
  cs::step(
    duck_jump_sim,
    {.forward = 1.0F, .buttons = cs::ButtonJump}
  );
  bool landed_on_ledge = false;
  float duck_jump_peak = duck_jump_sim.player.origin.y;
  float duck_jump_min_z = duck_jump_sim.player.origin.z;
  for (int tick = 0; tick < 64; ++tick) {
    cs::step(
      duck_jump_sim,
      {.forward = 1.0F, .buttons = cs::ButtonDuck}
    );
    duck_jump_peak = std::max(duck_jump_peak, duck_jump_sim.player.origin.y);
    duck_jump_min_z = std::min(duck_jump_min_z, duck_jump_sim.player.origin.z);
    if (
      duck_jump_sim.player.on_ground &&
      duck_jump_sim.player.origin.y > cs::kDuckedHalfHeight + 40.0F
    ) {
      landed_on_ledge = true;
      break;
    }
  }
  if (!landed_on_ledge) {
    std::fprintf(
      stderr,
      "duck-jump diagnostic: peak=%f min_z=%f final=(%f,%f,%f)\n",
      duck_jump_peak,
      duck_jump_min_z,
      duck_jump_sim.player.origin.x,
      duck_jump_sim.player.origin.y,
      duck_jump_sim.player.origin.z
    );
  }
  check(landed_on_ledge, "duck-jump lands on a fifty-eight-unit ledge");
}

void test_aim_arena_layout_and_traversal() {
  bool has_wood = false;
  bool has_metal = false;
  bool has_sand = false;
  for (const cs::BoxDefinition& box : cs::aim_arena_boxes()) {
    has_wood = has_wood || box.material == cs::MaterialWood;
    has_metal = has_metal || box.material == cs::MaterialMetal;
    has_sand = has_sand || box.material == cs::MaterialSand;
  }
  check(has_wood && has_metal && has_sand, "aim_arena exposes material-tagged shared authoring data");
  check(cs::aim_arena_spawns().size() == 2, "aim_arena provides two opposing spawn markers");

  cs::Simulation ramp_sim{};
  cs::initialize(ramp_sim);
  cs::set_player(
    ramp_sim,
    {-540.0F, cs::kStandingHalfHeight, 160.0F},
    {0.0F, 0.0F, -cs::kRunSpeed}
  );
  float ramp_peak = ramp_sim.player.origin.y;
  for (int tick = 0; tick < 80; ++tick) {
    cs::step(ramp_sim, {.forward = 1.0F});
    ramp_peak = std::max(ramp_peak, ramp_sim.player.origin.y);
  }
  check(ramp_peak > 80.0F, "convex brush trace walks up the arena ramp");
  check(ramp_sim.player.origin.z < -100.0F, "ramp route continues onto the raised platform");

  cs::Simulation stair_sim{};
  cs::initialize(stair_sim);
  cs::set_player(
    stair_sim,
    {540.0F, cs::kStandingHalfHeight, 180.0F},
    {0.0F, 0.0F, -cs::kRunSpeed}
  );
  float stair_peak = stair_sim.player.origin.y;
  for (int tick = 0; tick < 80; ++tick) {
    cs::step(stair_sim, {.forward = 1.0F});
    stair_peak = std::max(stair_peak, stair_sim.player.origin.y);
  }
  check(stair_peak > 80.0F, "step solver climbs the arena stairs");
  check(stair_sim.player.origin.z < -80.0F, "stair route continues onto the raised platform");

  cs::Simulation doorway_sim{};
  cs::initialize(doorway_sim);
  cs::set_player(
    doorway_sim,
    {0.0F, cs::kStandingHalfHeight, -250.0F},
    {0.0F, 0.0F, -cs::kRunSpeed}
  );
  run_ticks(doorway_sim, 32, {.forward = 1.0F});
  check(doorway_sim.player.origin.z < -350.0F, "player hull traverses the arena gate opening");
}

void test_weapon_table_patterns_and_speed() {
  const std::span<const cs::WeaponDefinition> weapons = cs::weapon_definitions();
  check(weapons.size() == cs::kWeaponCount, "weapon table contains knife plus six firearms");
  check(
    weapons[cs::WeaponAk47].magazine_capacity == 30 &&
    weapons[cs::WeaponAwp].base_damage > 100.0F,
    "weapon table exposes firearm-specific magazine and damage values"
  );
  const cs::Vec2 first = cs::weapon_pattern_offset(cs::WeaponAk47, 0);
  const cs::Vec2 ak_tenth = cs::weapon_pattern_offset(cs::WeaponAk47, 10);
  const cs::Vec2 mp5_tenth = cs::weapon_pattern_offset(cs::WeaponMp5, 10);
  check(first.x == 0.0F && first.y == 0.0F, "first recoil-pattern sample is centered");
  check(
    std::fabs(ak_tenth.y) > std::fabs(mp5_tenth.y),
    "AK pattern climbs more strongly than the MP5 pattern"
  );
  check(
    cs::hit_group_multiplier(cs::HitHead) == 4.0F &&
    cs::hit_group_multiplier(cs::HitChest) == 1.0F &&
    cs::hit_group_multiplier(cs::HitStomach) == 1.25F &&
    cs::hit_group_multiplier(cs::HitLimbs) == 0.75F,
    "all target hitgroups expose the intended damage multipliers"
  );

  cs::Simulation ak_move = flat_world();
  cs::select_weapon(ak_move, cs::WeaponAk47, true);
  run_ticks(ak_move, 128, {.forward = 1.0F});
  check(
    std::fabs(horizontal_speed(ak_move) - cs::weapon_definition(cs::WeaponAk47).max_move_speed) < 0.1F,
    "selected weapon controls the movement-speed cap"
  );
}

void test_damage_penetration_and_deterministic_fire() {
  cs::Simulation direct = target_world(false);
  cs::step(direct, {.buttons = cs::ButtonFire});
  check(direct.last_shot.result == cs::ShotKill, "stationary first shot hits the target head");
  check(direct.last_shot.hit_group == cs::HitHead, "target ray reports the head hitgroup");
  check(direct.weapon.magazine[cs::WeaponAk47] == 29, "firing consumes one cartridge");
  check(
    std::fabs(direct.last_shot.damage /
      (cs::weapon_definition(cs::WeaponAk47).base_damage *
       std::pow(cs::weapon_definition(cs::WeaponAk47).range_modifier, 200.0F / 500.0F)) -
      cs::hit_group_multiplier(cs::HitHead)) < 0.1F,
    "headshot damage applies range falloff then the hitgroup multiplier"
  );

  cs::Simulation repeated = target_world(false);
  cs::step(repeated, {.buttons = cs::ButtonFire});
  check(
    repeated.last_shot.result == direct.last_shot.result &&
    repeated.last_shot.damage == direct.last_shot.damage &&
    repeated.last_shot.end.x == direct.last_shot.end.x &&
    repeated.last_shot.end.y == direct.last_shot.end.y,
    "identical shot state produces an identical result and direction"
  );

  cs::Simulation wallbang = target_world(true);
  cs::step(wallbang, {.buttons = cs::ButtonFire});
  check(
    wallbang.last_shot.result == cs::ShotKill || wallbang.last_shot.result == cs::ShotHit,
    "AK penetrates a thin wood panel"
  );
  check(wallbang.last_shot.penetrations == 1, "wallbang reports one penetrated surface");
  check(
    wallbang.last_shot.damage < direct.last_shot.damage,
    "wood penetration reduces delivered damage"
  );
}

void test_fire_cadence_reload_and_target_motion() {
  cs::Simulation automatic = flat_world();
  cs::select_weapon(automatic, cs::WeaponAk47, true);
  const std::uint32_t starting_ammo = automatic.weapon.magazine[cs::WeaponAk47];
  run_ticks(automatic, 18, {.buttons = cs::ButtonFire});
  const std::uint32_t rounds_fired = starting_ammo - automatic.weapon.magazine[cs::WeaponAk47];
  check(rounds_fired == 3, "automatic fire obeys the six-tick AK cadence");

  cs::Simulation reload = flat_world();
  cs::select_weapon(reload, cs::WeaponUsp, true);
  reload.weapon.magazine[cs::WeaponUsp] = 1;
  reload.weapon.reserve[cs::WeaponUsp] = 5;
  cs::step(reload, {.buttons = cs::ButtonFire});
  cs::step(reload, {});
  cs::step(reload, {.buttons = cs::ButtonReload});
  check(reload.weapon.reload_ticks > 0, "reload input starts the weapon reload timer");
  run_ticks(reload, cs::weapon_definition(cs::WeaponUsp).reload_ticks, {});
  check(
    reload.weapon.magazine[cs::WeaponUsp] == 5 &&
    reload.weapon.reserve[cs::WeaponUsp] == 0,
    "completed reload transfers available reserve ammunition"
  );

  cs::Simulation moving{};
  cs::initialize(moving);
  const float target_start = moving.targets[0].origin.x;
  run_ticks(moving, 32, {});
  check(
    moving.targets[0].origin.x > target_start + 20.0F,
    "aim_arena target motion advances in the fixed-tick simulation"
  );
}

void test_determinism() {
  cs::Simulation first = flat_world();
  cs::Simulation second = flat_world();
  for (int tick = 0; tick < 600; ++tick) {
    cs::InputCommand command{
      .forward = tick % 90 < 55 ? 1.0F : 0.0F,
      .strafe = tick % 120 < 60 ? 0.5F : -0.5F,
      .yaw = static_cast<float>(tick) * 0.004F,
      .pitch = std::sin(static_cast<float>(tick) * 0.01F) * 0.05F,
      .buttons =
        (tick % 80 == 0 ? cs::ButtonJump : 0U) |
        (tick % 48 < 18 ? cs::ButtonFire : 0U) |
        (tick == 220 ? cs::ButtonReload : 0U),
      .requested_weapon = tick == 300 ? cs::WeaponMp5 : cs::WeaponNone,
    };
    cs::step(first, command);
    cs::step(second, command);
  }
  check(cs::state_hash(first) == cs::state_hash(second), "identical command streams produce identical state hashes");
}

}  // namespace

int main() {
  test_ground_move_and_counter_strafe();
  test_air_strafe_gain();
  test_jump_fatigue_and_bhop_cap();
  test_duck_wall_and_step_collision();
  test_aim_arena_layout_and_traversal();
  test_weapon_table_patterns_and_speed();
  test_damage_penetration_and_deterministic_fire();
  test_fire_cadence_reload_and_target_motion();
  test_determinism();
  if (failures != 0) return 1;
  std::puts("cs_sim M1 movement, M2 arena, and M3 gunplay tests passed");
  return 0;
}
