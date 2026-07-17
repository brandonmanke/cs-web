#pragma once

#include <cstdint>

// cs-web simulation core. Fixed-tick, deterministic, flat POD state.
// Units: GoldSrc units (1u = 1 inch), Y-up, right-handed (matches glTF/Three.js).
// Angles are radians. Yaw 0 faces -Z, positive yaw turns left (counter-clockwise
// around +Y). Pitch is positive looking up.

namespace cs {

inline constexpr std::uint32_t kSimApiVersion = 1;

// --- fixed tick ---
inline constexpr float kTickRate = 64.0F;
inline constexpr float kTickSeconds = 1.0F / kTickRate;

// --- movement, GoldSrc/CS 1.6 derived ---
inline constexpr float kGravity = 800.0F;
inline constexpr float kGroundAccelerate = 5.0F;
inline constexpr float kAirAccelerate = 10.0F;
inline constexpr float kAirWishSpeedCap = 30.0F;
inline constexpr float kFriction = 4.0F;
inline constexpr float kStopSpeed = 75.0F;
inline constexpr float kMaxSpeed = 250.0F;
inline constexpr float kJumpImpulse = 268.328157F; // sqrt(2 * gravity * 45u)
inline constexpr float kBhopSpeedFactor = 1.7F;    // PM_PreventMegaBunnyJumping
inline constexpr float kBhopSlowdown = 0.65F;
inline constexpr float kStaminaFull = 1315.789429F; // GoldSrc fuser2 jump fatigue
inline constexpr float kStaminaDrainPerSecond = 1000.0F;
inline constexpr float kStepHeight = 18.0F;
inline constexpr float kHullHalfWidth = 16.0F;       // 32x32 footprint
inline constexpr float kHullHalfHeightStand = 36.0F; // 72u tall
inline constexpr float kHullHalfHeightDuck = 18.0F;  // 36u tall
inline constexpr float kEyeAboveCenterStand = 28.0F;
inline constexpr float kEyeAboveCenterDuck = 12.0F;
inline constexpr float kDuckSpeedFactor = 0.333F;
inline constexpr float kGroundNormalMinY = 0.7F;
inline constexpr float kMaxVelocityPerAxis = 2000.0F;
inline constexpr float kShotRange = 8192.0F;

inline constexpr std::uint32_t kMaxTargets = 8;
inline constexpr std::uint32_t kWeaponCount = 8;

struct Vec3 {
  float x;
  float y;
  float z;
};

enum Button : std::uint32_t {
  ButtonJump = 1U << 0U,
  ButtonDuck = 1U << 1U,
  ButtonFire = 1U << 2U,
  ButtonReload = 1U << 3U,
};

enum SnapshotFlag : std::uint32_t {
  SnapOnGround = 1U << 0U,
  SnapDucked = 1U << 1U,
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
  ShotWorld = 1, // hit world geometry
  ShotMiss = 2,  // hit nothing within range
  ShotHit = 3,   // damaged a target
  ShotKill = 4,  // killed a target
  ShotDry = 5,   // empty magazine
};

struct InputCommand {
  float forward; // -1..1
  float strafe;  // -1..1, positive = right
  float yaw;     // radians
  float pitch;   // radians
  std::uint32_t buttons;
  std::uint32_t weapon; // requested WeaponId, 0 = keep current
};

struct WeaponDef {
  WeaponId id;
  const char* name;
  std::uint32_t magazine;
  std::uint32_t reserve;
  float base_damage;
  float range_modifier;    // damage *= pow(range_modifier, dist / 500)
  float spread;            // base inaccuracy, radians
  float pattern_scale;     // spray pattern magnitude multiplier
  float punch_per_shot;    // view punch, radians
  float max_move_speed;
  std::uint32_t fire_ticks;
  std::uint32_t reload_ticks;
  std::uint32_t recovery_ticks; // ticks of not firing before spray resets
  bool automatic;
};

struct ShotEvent {
  std::uint32_t sequence; // increments per shot fired; 0 = no shot yet
  std::uint32_t result;   // ShotResult
  std::uint32_t hit_group;
  std::uint32_t target_index;
  std::uint32_t material; // world material hit (ShotWorld)
  float damage;
  Vec3 start;
  Vec3 end;
};

struct TargetSnapshot {
  Vec3 origin; // feet position
  float health;
  std::uint32_t alive;
  std::uint32_t flash_ticks; // hit flash countdown, for renderer fx
};

struct SimSnapshot {
  std::uint32_t api_version;
  std::uint32_t tick;
  Vec3 origin;   // hull center
  Vec3 velocity;
  float eye_height; // eye offset above origin (duck-lerped)
  float speed_h;    // horizontal speed, u/s
  float stamina;
  std::uint32_t flags; // SnapshotFlag
  std::uint32_t weapon;
  std::uint32_t magazine;
  std::uint32_t reserve;
  std::uint32_t cooldown_ticks;
  std::uint32_t reload_ticks;
  float punch_pitch; // radians
  float punch_yaw;
  std::uint32_t kills;
  std::uint32_t hits;
  std::uint32_t shots;
  ShotEvent last_shot;
  std::uint32_t target_count;
  TargetSnapshot targets[kMaxTargets];
};

static_assert(sizeof(SimSnapshot) % 4 == 0);
static_assert(sizeof(Vec3) == 12);

const WeaponDef& weapon_def(WeaponId id);

} // namespace cs

// C ABI consumed by the WASM client and native tests. All pointers are into the
// caller-visible heap; the snapshot pointer stays valid for the sim lifetime.
extern "C" {

void sim_create();
void sim_world_reset();
void sim_add_box(float min_x, float min_y, float min_z, float max_x, float max_y,
                 float max_z, std::uint32_t material);
// points: xyz triples forming a convex point cloud
void sim_add_hull(const float* points, std::uint32_t point_count, std::uint32_t material);
// vertices: xyz triples, indices: 3 per triangle. Returns 0 on failure.
int sim_add_mesh(const float* vertices, std::uint32_t vertex_count,
                 const std::uint32_t* indices, std::uint32_t triangle_count,
                 std::uint32_t material);
void sim_world_finalize();
void sim_spawn(float x, float y, float z, float yaw);
void sim_add_target(float x, float y, float z, float patrol_min_x, float patrol_max_x,
                    float speed);
void sim_step(float forward, float strafe, float yaw, float pitch,
              std::uint32_t buttons, std::uint32_t weapon);
const cs::SimSnapshot* sim_snapshot();
std::uint32_t sim_snapshot_bytes();
}
