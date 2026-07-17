#pragma once

#include <array>
#include <cstdint>
#include <span>

namespace cs {

inline constexpr std::uint32_t kSimApiVersion = 3;
inline constexpr float kTickSeconds = 1.0F / 64.0F;
inline constexpr float kGravity = 800.0F;
inline constexpr float kGroundAccelerate = 5.0F;
inline constexpr float kAirAccelerate = 10.0F;
inline constexpr float kAirWishSpeedCap = 30.0F;
inline constexpr float kFriction = 4.0F;
inline constexpr float kStopSpeed = 75.0F;
inline constexpr float kRunSpeed = 250.0F;
inline constexpr float kJumpImpulse = 268.328157F;
inline constexpr float kStepHeight = 18.0F;
inline constexpr float kStandingHalfHeight = 36.0F;
inline constexpr float kDuckedHalfHeight = 18.0F;
inline constexpr float kHullRadius = 16.0F;
inline constexpr std::uint32_t kMaxSolids = 128;
inline constexpr std::uint32_t kMaxBrushPlanes = 12;
inline constexpr std::uint32_t kMaxTargets = 8;
inline constexpr std::uint32_t kWeaponCount = 8;

struct Vec3 {
  float x;
  float y;
  float z;
};

struct Vec2 {
  float x;
  float y;
};

enum Button : std::uint32_t {
  ButtonJump = 1U << 0U,
  ButtonDuck = 1U << 1U,
  ButtonFire = 1U << 2U,
  ButtonReload = 1U << 3U,
};

enum PlayerFlag : std::uint32_t {
  PlayerOnGround = 1U << 0U,
  PlayerDucked = 1U << 1U,
};

enum Material : std::uint32_t {
  MaterialConcrete = 0,
  MaterialWood = 1,
  MaterialMetal = 2,
  MaterialSand = 3,
};

enum WeaponId : std::uint32_t {
  WeaponNone = 0,
  WeaponKnife = 1,
  WeaponUsp = 2,
  WeaponGlock = 3,
  WeaponAk47 = 4,
  WeaponM4a1 = 5,
  WeaponAwp = 6,
  WeaponMp5 = 7,
};

enum HitGroup : std::uint32_t {
  HitNone = 0,
  HitHead = 1,
  HitChest = 2,
  HitStomach = 3,
  HitLimbs = 4,
};

enum ShotResult : std::uint32_t {
  ShotNone = 0,
  ShotMiss = 1,
  ShotWorld = 2,
  ShotHit = 3,
  ShotKill = 4,
  ShotDry = 5,
};

struct InputCommand {
  float forward;
  float strafe;
  float yaw;
  float pitch;
  std::uint32_t buttons;
  std::uint32_t requested_weapon;
};

struct WeaponDefinition {
  WeaponId id;
  const char* name;
  std::uint32_t magazine_capacity;
  std::uint32_t reserve_capacity;
  float base_damage;
  float range_modifier;
  float penetration_power;
  float spread;
  float pattern_scale;
  float max_move_speed;
  std::uint32_t fire_ticks;
  std::uint32_t reload_ticks;
  std::uint32_t max_penetrations;
  bool automatic;
};

struct WeaponState {
  WeaponId selected;
  std::array<std::uint32_t, kWeaponCount> magazine;
  std::array<std::uint32_t, kWeaponCount> reserve;
  std::uint32_t cooldown_ticks;
  std::uint32_t reload_ticks;
  std::uint32_t shot_index;
  std::uint32_t recovery_ticks;
  std::uint32_t shot_sequence;
  float punch_pitch;
  float punch_yaw;
  bool fire_held;
};

struct TargetState {
  Vec3 origin;
  float min_x;
  float max_x;
  float speed;
  float health;
  std::uint32_t respawn_ticks;
  std::uint32_t hit_flash_ticks;
  bool alive;
};

struct TargetSnapshot {
  Vec3 origin;
  float health;
  std::uint32_t hit_flash_ticks;
  std::uint32_t alive;
};

struct ShotEvent {
  std::uint32_t sequence;
  std::uint32_t result;
  std::uint32_t hit_group;
  std::uint32_t target_index;
  std::uint32_t material;
  std::uint32_t penetrations;
  float damage;
  Vec3 start;
  Vec3 end;
};

struct Plane {
  Vec3 normal;
  float distance;
};

struct Solid {
  std::array<Plane, kMaxBrushPlanes> planes;
  std::uint32_t plane_count;
  std::uint32_t material;
};

struct BoxDefinition {
  Vec3 mins;
  Vec3 maxs;
  std::uint32_t material;
};

struct RampDefinition {
  float min_x;
  float max_x;
  float min_z;
  float max_z;
  float base_y;
  float height;
  std::uint32_t material;
};

struct PlayerState {
  Vec3 origin;
  Vec3 velocity;
  float yaw;
  float stamina;
  bool on_ground;
  bool ducked;
  bool jump_held;
};

struct SimSnapshot {
  std::uint32_t api_version;
  std::uint32_t tick;
  Vec3 player_origin;
  Vec3 player_velocity;
  float view_height;
  float stamina;
  float horizontal_speed;
  std::uint32_t player_flags;
  std::uint32_t weapon;
  std::uint32_t magazine;
  std::uint32_t reserve;
  std::uint32_t reload_ticks;
  float punch_pitch;
  float punch_yaw;
  std::uint32_t kills;
  std::uint32_t hits;
  ShotEvent last_shot;
  std::uint32_t target_count;
  std::array<TargetSnapshot, kMaxTargets> targets;
};

struct Simulation {
  PlayerState player;
  std::array<Solid, kMaxSolids> solids;
  std::uint32_t solid_count;
  WeaponState weapon;
  std::array<TargetState, kMaxTargets> targets;
  std::uint32_t target_count;
  std::uint32_t kills;
  std::uint32_t hits;
  ShotEvent last_shot;
  std::uint32_t tick;
  SimSnapshot snapshot;
};

void initialize(Simulation& simulation);
void load_aim_lab(Simulation& simulation);
void load_aim_arena(Simulation& simulation);
void clear_world(Simulation& simulation);
bool add_solid(Simulation& simulation, Vec3 mins, Vec3 maxs, std::uint32_t material = 0);
bool add_convex_solid(
  Simulation& simulation,
  std::span<const Plane> planes,
  std::uint32_t material = 0
);
bool add_ramp(Simulation& simulation, const RampDefinition& ramp);
std::span<const BoxDefinition> aim_arena_boxes();
std::span<const RampDefinition> aim_arena_ramps();
std::span<const Vec3> aim_arena_spawns();
std::span<const WeaponDefinition> weapon_definitions();
const WeaponDefinition& weapon_definition(WeaponId weapon);
Vec2 weapon_pattern_offset(WeaponId weapon, std::uint32_t shot_index);
float hit_group_multiplier(HitGroup hit_group);
void clear_targets(Simulation& simulation);
bool add_target(
  Simulation& simulation,
  Vec3 origin,
  float min_x,
  float max_x,
  float speed
);
void select_weapon(Simulation& simulation, WeaponId weapon, bool immediate = false);
void set_player(Simulation& simulation, Vec3 origin, Vec3 velocity = {0.0F, 0.0F, 0.0F});
void step(Simulation& simulation, const InputCommand& command);
std::uint64_t state_hash(const Simulation& simulation);

}  // namespace cs

extern "C" {

std::uint32_t sim_create();
void sim_step(const cs::InputCommand* command);
const cs::SimSnapshot* sim_snapshot();

}
