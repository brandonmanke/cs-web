#include "state.h"
#include "world.h"

#include <cmath>
#include <cstring>

// Sim orchestration + C ABI. One global sim instance (single player for now;
// the flat state makes multi-instance or rollback a memcpy problem later).

namespace cs {
namespace {

SimState g_state;

void reset_player(SimState& s) {
  s.player = {};
  s.player.origin = {0.0F, kHullHalfHeightStand + 1.0F, 0.0F};
  s.player.view_offset = kEyeAboveCenterStand;
}

} // namespace

SimState& state() { return g_state; }

void refresh_snapshot(SimState& s) {
  SimSnapshot& snap = s.snapshot;
  snap.api_version = kSimApiVersion;
  snap.tick = s.tick;
  snap.origin = s.player.origin;
  snap.velocity = s.player.velocity;
  snap.eye_height = s.player.view_offset;
  snap.speed_h = std::sqrt(s.player.velocity.x * s.player.velocity.x +
                           s.player.velocity.z * s.player.velocity.z);
  snap.stamina = s.player.stamina;
  snap.flags = (s.player.on_ground ? SnapOnGround : 0U) |
               (s.player.ducked ? SnapDucked : 0U);
  snap.weapon = s.weapon.selected;
  snap.magazine = s.weapon.magazine[s.weapon.selected];
  snap.reserve = s.weapon.reserve[s.weapon.selected];
  snap.cooldown_ticks = s.weapon.cooldown_ticks;
  snap.reload_ticks = s.weapon.reload_ticks;
  snap.punch_pitch = s.weapon.punch_pitch;
  snap.punch_yaw = s.weapon.punch_yaw;
  snap.kills = s.kills;
  snap.hits = s.hits;
  snap.shots = s.shots;
  snap.last_shot = s.last_shot;
  snap.target_count = s.target_count;
  for (std::uint32_t i = 0; i < kMaxTargets; ++i) {
    const TargetState& t = s.targets[i];
    snap.targets[i] = {t.origin, t.health, t.alive ? 1U : 0U, t.flash_ticks};
  }
}

std::uint64_t state_hash(const SimState& s) {
  // FNV-1a over the deterministic core (player + weapon + targets + rng + tick).
  std::uint64_t hash = 1469598103934665603ULL;
  auto mix = [&hash](const void* data, std::size_t bytes) {
    const auto* p = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < bytes; ++i) {
      hash ^= p[i];
      hash *= 1099511628211ULL;
    }
  };
  mix(&s.player, sizeof(s.player));
  mix(&s.weapon, sizeof(s.weapon));
  mix(&s.targets, sizeof(s.targets));
  mix(&s.target_count, sizeof(s.target_count));
  mix(&s.rng, sizeof(s.rng));
  mix(&s.tick, sizeof(s.tick));
  return hash;
}

} // namespace cs

using cs::g_state;

extern "C" {

void sim_create() {
  cs::world_create();
  std::memset(&g_state, 0, sizeof(g_state));
  g_state.rng = 0x9E3779B9U;
  cs::reset_player(g_state);
  cs::weapons_reset(g_state);
  cs::refresh_snapshot(g_state);
}

void sim_world_reset() {
  cs::world_reset();
  g_state.target_count = 0;
}

void sim_add_box(float min_x, float min_y, float min_z, float max_x, float max_y,
                 float max_z, std::uint32_t material) {
  cs::world_add_box({min_x, min_y, min_z}, {max_x, max_y, max_z}, material);
}

void sim_add_hull(const float* points, std::uint32_t point_count, std::uint32_t material) {
  cs::world_add_hull(points, point_count, material);
}

int sim_add_mesh(const float* vertices, std::uint32_t vertex_count,
                 const std::uint32_t* indices, std::uint32_t triangle_count,
                 std::uint32_t material) {
  return cs::world_add_mesh(vertices, vertex_count, indices, triangle_count, material)
             ? 1
             : 0;
}

void sim_world_finalize() { cs::world_finalize(); }

void sim_spawn(float x, float y, float z, float yaw) {
  cs::reset_player(g_state);
  g_state.player.origin = {x, y, z};
  g_state.player.yaw = yaw;
  cs::refresh_snapshot(g_state);
}

void sim_add_target(float x, float y, float z, float patrol_min_x, float patrol_max_x,
                    float speed) {
  if (g_state.target_count >= cs::kMaxTargets) {
    return;
  }
  cs::TargetState& t = g_state.targets[g_state.target_count];
  t = {};
  t.origin = {x, y, z};
  t.patrol_min_x = patrol_min_x;
  t.patrol_max_x = patrol_max_x;
  t.speed = speed;
  t.health = 100.0F;
  t.alive = true;
  ++g_state.target_count;
}

void sim_step(float forward, float strafe, float yaw, float pitch,
              std::uint32_t buttons, std::uint32_t weapon) {
  cs::InputCommand cmd = {forward, strafe, yaw, pitch, buttons, weapon};
  if (cmd.forward > 1.0F) cmd.forward = 1.0F;
  if (cmd.forward < -1.0F) cmd.forward = -1.0F;
  if (cmd.strafe > 1.0F) cmd.strafe = 1.0F;
  if (cmd.strafe < -1.0F) cmd.strafe = -1.0F;
  cs::pmove_run(g_state, cmd);
  cs::weapons_run(g_state, cmd);
  cs::targets_run(g_state);
  ++g_state.tick;
  cs::refresh_snapshot(g_state);
}

const cs::SimSnapshot* sim_snapshot() { return &g_state.snapshot; }

std::uint32_t sim_snapshot_bytes() {
  return static_cast<std::uint32_t>(sizeof(cs::SimSnapshot));
}
}
