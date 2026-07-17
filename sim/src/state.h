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
  bool on_ground;
  bool ducked;
  bool jump_held;
};

struct WeaponState {
  WeaponId selected;
  std::uint32_t magazine[kWeaponCount];
  std::uint32_t reserve[kWeaponCount];
  std::uint32_t cooldown_ticks;
  std::uint32_t reload_ticks;
  std::uint32_t shot_index;     // position in spray pattern
  std::uint32_t idle_ticks;     // ticks since last shot, for spray recovery
  std::uint32_t shot_sequence;
  float punch_pitch;
  float punch_yaw;
  bool fire_held;
};

struct TargetState {
  Vec3 origin; // feet
  float patrol_min_x;
  float patrol_max_x;
  float speed; // signed, flips at patrol bounds
  float health;
  std::uint32_t respawn_ticks;
  std::uint32_t flash_ticks;
  bool alive;
};

struct SimState {
  PlayerState player;
  WeaponState weapon;
  TargetState targets[kMaxTargets];
  std::uint32_t target_count;
  std::uint32_t kills;
  std::uint32_t hits;
  std::uint32_t shots;
  std::uint32_t rng; // xorshift32 state
  std::uint32_t tick;
  ShotEvent last_shot;
  SimSnapshot snapshot;
};

SimState& state();
void refresh_snapshot(SimState& s);
std::uint64_t state_hash(const SimState& s);

// pmove.cpp
void pmove_run(SimState& s, const InputCommand& cmd);
// weapons.cpp
void weapons_reset(SimState& s);
void weapons_run(SimState& s, const InputCommand& cmd);
void targets_run(SimState& s);

inline float rand_float(SimState& s) { // [0, 1)
  std::uint32_t x = s.rng;
  x ^= x << 13U;
  x ^= x >> 17U;
  x ^= x << 5U;
  s.rng = x;
  return static_cast<float>(x >> 8U) * (1.0F / 16777216.0F);
}

} // namespace cs
