#pragma once

#include "cs/sim.h"

// Internal sim state. Flat POD so future rollback/netcode can memcpy it.
// Not part of the C ABI; native tests may include this for deep asserts.

namespace cs {

struct PlayerState {
  Vec3 origin; // hull center
  Vec3 velocity;
  float yaw;
  float pitch;
  float stamina;     // GoldSrc fuser2-style jump fatigue, counts down to 0
  float view_offset; // eye height above origin, lerps between duck/stand
  float step_distance; // ground distance travelled since the last footfall
  std::uint32_t jump_buffer_ticks; // an early jump tap, waiting for the ground
  std::uint32_t ground_material;   // Material under the feet, from the last trace
  bool on_ground;
  bool ducked;
  bool jump_held;
  /** Impact speed of a touchdown this tick, 0 if there wasn't one. */
  float land_speed;
  /** A footfall happened this tick. Both are consumed by sim.cpp as events. */
  bool stepped;
};

struct WeaponState {
  WeaponId selected;
  std::uint32_t magazine[kWeaponCount];
  std::uint32_t reserve[kWeaponCount];
  std::uint32_t cooldown_ticks;
  std::uint32_t reload_ticks;
  std::uint32_t shot_index;     // position in spray pattern
  std::uint32_t idle_ticks;     // ticks since last shot, for spray recovery
  std::uint32_t zoom;           // 0 = hip, 1..2 index into WeaponDef::zoom_fov
  float punch_pitch;
  float punch_yaw;
  bool fire_held;
  bool zoom_held;
};

// Everything the AI needs, kept inside the deterministic state so a bot match
// hashes the same twice. Unused on the local player.
struct BotState {
  float skill;           // 0 = easy, 1 = normal, 2 = hard, continuous between
  std::uint32_t target;  // player index being engaged, or kMaxPlayers
  std::uint32_t scan_ticks;     // until the next target re-scan
  std::uint32_t reaction_ticks; // until it may open fire on a fresh target
  std::uint32_t burst_ticks;    // remaining ticks of the current burst
  std::uint32_t rest_ticks;     // remaining ticks between bursts
  std::uint32_t error_ticks;    // until the aim error is re-rolled
  std::uint32_t goal_ticks;     // until the roam goal is abandoned
  std::uint32_t strafe_ticks;   // remaining ticks of the current strafe leg
  std::uint32_t stuck_ticks;    // consecutive ticks of going nowhere
  float aim_yaw_error;
  float aim_pitch_error;
  Vec3 goal;
  float strafe_dir; // -1 or 1
};

struct PlayerEntity {
  PlayerState move;
  WeaponState weapon;
  BotState bot;
  /** What to hand this player on respawn — their last deliberate pick. */
  WeaponId loadout;
  float health;
  std::uint32_t team;
  std::uint32_t kills;
  std::uint32_t deaths;
  std::uint32_t hits;
  std::uint32_t shots;
  std::uint32_t respawn_ticks;
  std::uint32_t flash_ticks;
  bool alive;
  bool is_bot;
  bool active;
};

struct SpawnPoint {
  Vec3 origin; // hull center
  float yaw;
  std::uint32_t team; // TeamNone = usable by anyone
};

struct SimState {
  PlayerEntity players[kMaxPlayers];
  std::uint32_t player_count;
  std::uint32_t mode;
  std::uint32_t team_score[3];
  SpawnPoint spawns[kMaxSpawns];
  std::uint32_t spawn_count;
  std::uint32_t rng; // xorshift32 state
  std::uint32_t tick;
  SimEvent events[kMaxEvents];
  std::uint32_t event_count;
  SimSnapshot snapshot;
};

SimState& state();
void refresh_snapshot(SimState& s);
std::uint64_t state_hash(const SimState& s);

/** Queue a client-visible event. Silently drops once the tick's array is full. */
SimEvent& push_event(SimState& s, EventKind kind, std::uint32_t actor);

/** Eye position of a player, the origin of everything they shoot or see. */
inline Vec3 eye_of(const PlayerEntity& e) {
  return {e.move.origin.x, e.move.origin.y + e.move.view_offset, e.move.origin.z};
}

/** Feet position — hitboxes and the renderer are both authored from here. */
inline Vec3 feet_of(const PlayerEntity& e) {
  const float half = e.move.ducked ? kHullHalfHeightDuck : kHullHalfHeightStand;
  return {e.move.origin.x, e.move.origin.y - half, e.move.origin.z};
}

/** True when `viewer` may damage `other`: alive, not self, not a teammate. */
bool is_enemy(const SimState& s, std::uint32_t viewer, std::uint32_t other);

// pmove.cpp — drives any entity; `base_max_speed` is the weapon/zoom cap before
// the duck and walk factors.
void pmove_run(PlayerState& p, const InputCommand& cmd, float base_max_speed);

// weapons.cpp
void weapons_reset(PlayerEntity& e, WeaponId selected);
void weapons_run(SimState& s, std::uint32_t index, const InputCommand& cmd);
/** Weapon max speed after the scope penalty; pmove applies duck/walk on top. */
float weapon_base_speed(const PlayerEntity& e);

// bots.cpp — produces the command a bot would have typed this tick; the caller
// feeds it through the same pmove/weapons path the local player uses.
InputCommand bot_think(SimState& s, std::uint32_t index);
void bot_reset(SimState& s, std::uint32_t index, float skill);

inline float rand_float(SimState& s) { // [0, 1)
  std::uint32_t x = s.rng;
  x ^= x << 13U;
  x ^= x >> 17U;
  x ^= x << 5U;
  s.rng = x;
  return static_cast<float>(x >> 8U) * (1.0F / 16777216.0F);
}

inline std::uint32_t rand_below(SimState& s, std::uint32_t bound) {
  return bound == 0U ? 0U : static_cast<std::uint32_t>(rand_float(s) * static_cast<float>(bound)) % bound;
}

} // namespace cs
