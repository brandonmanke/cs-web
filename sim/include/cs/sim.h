#pragma once

#include <array>
#include <cstdint>
#include <span>

namespace cs {

inline constexpr std::uint32_t kSimApiVersion = 2;
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

struct Vec3 {
  float x;
  float y;
  float z;
};

enum Button : std::uint32_t {
  ButtonJump = 1U << 0U,
  ButtonDuck = 1U << 1U,
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

struct InputCommand {
  float forward;
  float strafe;
  float yaw;
  std::uint32_t buttons;
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
};

struct Simulation {
  PlayerState player;
  std::array<Solid, kMaxSolids> solids;
  std::uint32_t solid_count;
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
void set_player(Simulation& simulation, Vec3 origin, Vec3 velocity = {0.0F, 0.0F, 0.0F});
void step(Simulation& simulation, const InputCommand& command);
std::uint64_t state_hash(const Simulation& simulation);

}  // namespace cs

extern "C" {

std::uint32_t sim_create();
void sim_step(const cs::InputCommand* command);
const cs::SimSnapshot* sim_snapshot();

}
