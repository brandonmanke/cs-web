#pragma once

#include <cstdint>

// cs-web simulation core. Fixed-tick, deterministic, flat POD state.
// Units: GoldSrc units (1u = 1 inch), Y-up, right-handed (matches glTF/Three.js).
// Angles are radians. Yaw 0 faces -Z, positive yaw turns left (counter-clockwise
// around +Y). Pitch is positive looking up.

namespace cs {

inline constexpr std::uint32_t kSimApiVersion = 3;

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
// Deliberately faster than GoldSrc's 1000/s: a hop lasts ~0.53 s, so most of
// the fatigue has bled off by the time you land and a chained hop keeps ~89% of
// its speed instead of ~85%. Bhop still decays without air-strafing, it just
// forgives a sloppier one. See PLAN.md section 3.
inline constexpr float kStaminaDrainPerSecond = 1400.0F;
// Jump pressed this many ticks before touching ground still hops on landing.
// 1.6 wants a frame-perfect tap; this keeps the tap-per-hop rhythm (holding
// jump does *not* auto-hop) while forgiving ~125 ms of early press.
inline constexpr std::uint32_t kJumpBufferTicks = 8;
inline constexpr float kStepHeight = 18.0F;
inline constexpr float kHullHalfWidth = 16.0F;       // 32x32 footprint
inline constexpr float kHullHalfHeightStand = 36.0F; // 72u tall
inline constexpr float kHullHalfHeightDuck = 18.0F;  // 36u tall
inline constexpr float kEyeAboveCenterStand = 28.0F;
inline constexpr float kEyeAboveCenterDuck = 12.0F;
inline constexpr float kDuckSpeedFactor = 0.333F;
inline constexpr float kWalkSpeedFactor = 0.52F;
inline constexpr float kGroundNormalMinY = 0.7F;
inline constexpr float kMaxVelocityPerAxis = 2000.0F;
inline constexpr float kShotRange = 8192.0F;

// --- optics ---
inline constexpr float kBaseFov = 90.0F;
// Scoping costs mobility; leaving the scope costs accuracy. Both are what make
// the AWP a positional weapon instead of a run-and-gun one.
inline constexpr float kZoomSpeedFactor = 0.52F;
inline constexpr float kUnscopedSpreadScale = 7.0F;

// --- footsteps ---
// Distance between footfalls. Accumulating distance rather than time means a
// ducked player steps as rarely as they move, for free.
inline constexpr float kStrideDistance = 82.0F;
/** Below this you are shuffling, not walking, and make no noise. */
inline constexpr float kStepMinSpeed = 55.0F;
/**
 * Impact speed above which a touchdown is a heavy landing rather than an
 * ordinary one. Set clear of kJumpImpulse (268) on purpose: a hop is not a
 * fall. *Every* touchdown makes some noise though — a silent bhop would be a
 * stealth exploit, and +speed is supposed to be the only way to move quietly.
 */
inline constexpr float kLandingSpeed = 300.0F;

// --- match ---
inline constexpr float kPlayerHealth = 100.0F;
inline constexpr std::uint32_t kRespawnTicks = 128; // 2 s
inline constexpr std::uint32_t kHitFlashTicks = 8;

inline constexpr std::uint32_t kMaxPlayers = 10;
inline constexpr std::uint32_t kMaxSpawns = 24;
// Shots plus footfalls, so a full roster running and firing at once still fits
// with room to spare; overflow only ever costs a tracer or a footstep.
inline constexpr std::uint32_t kMaxEvents = 12;
inline constexpr std::uint32_t kWeaponCount = 8;
inline constexpr std::uint32_t kLocalPlayer = 0;

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
  ButtonWalk = 1U << 4U, // +speed: quiet, slow, accurate
  ButtonZoom = 1U << 5U, // secondary fire: cycles scope levels
};

enum SnapshotFlag : std::uint32_t {
  SnapOnGround = 1U << 0U,
  SnapDucked = 1U << 1U,
  SnapAlive = 1U << 2U,
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
  ShotHit = 3,   // damaged a player
  ShotKill = 4,  // killed a player
  ShotDry = 5,   // empty magazine
};

enum Team : std::uint32_t {
  TeamNone = 0, // free-for-all
  TeamT = 1,
  TeamCt = 2,
};

enum GameMode : std::uint32_t {
  ModeRange = 0,       // bots roam but never shoot; the practice greybox
  ModeDeathmatch = 1,  // free-for-all
  ModeTeam = 2,        // T vs CT, no friendly fire
};

enum EventKind : std::uint32_t {
  EventNone = 0,
  EventShot = 1,  // a bullet was fired; start/end/result describe where it went
  EventDeath = 2, // victim died at actor's hands
  EventStep = 3,  // a foot hit the ground; start = feet, material = surface,
                  // result = StepKind
};

enum StepKind : std::uint32_t {
  StepWalk = 0, // a footfall mid-stride
  StepLand = 1, // touching down out of a jump or a fall
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
  // Scope FOVs in degrees, in cycle order; 0 ends the cycle. A weapon with no
  // optics leaves both at 0.
  float zoom_fov[2];
};

// One tick's worth of things worth hearing or drawing. The client reads the
// snapshot after every step, so a per-tick array beats a ring buffer.
struct SimEvent {
  std::uint32_t kind;   // EventKind
  std::uint32_t actor;  // player index that caused it
  std::uint32_t victim; // player index, or kMaxPlayers for none
  std::uint32_t result; // ShotResult
  std::uint32_t hit_group;
  std::uint32_t material; // world material hit (ShotWorld)
  std::uint32_t weapon;
  float damage;
  Vec3 start;
  Vec3 end;
};

struct PlayerSnapshot {
  Vec3 origin; // hull center
  float yaw;
  float pitch;
  float health;
  float speed_h;
  std::uint32_t team;
  std::uint32_t flags; // SnapshotFlag
  std::uint32_t weapon;
  std::uint32_t kills;
  std::uint32_t deaths;
  std::uint32_t flash_ticks; // hit flash countdown, for renderer fx
  std::uint32_t is_bot;
};

struct SimSnapshot {
  std::uint32_t api_version;
  std::uint32_t tick;
  std::uint32_t mode;
  std::uint32_t local_index;

  // --- local player view: what the camera, viewmodel and HUD need ---
  Vec3 origin;   // hull center
  Vec3 velocity;
  float eye_height; // eye offset above origin (duck-lerped)
  float speed_h;    // horizontal speed, u/s
  float stamina;
  float fov;        // degrees; drops while scoped
  std::uint32_t flags; // SnapshotFlag
  std::uint32_t zoom;  // 0 = hip, 1..2 = scope level
  std::uint32_t weapon;
  std::uint32_t magazine;
  std::uint32_t reserve;
  std::uint32_t cooldown_ticks;
  std::uint32_t reload_ticks;
  float punch_pitch; // radians
  float punch_yaw;
  float health;
  std::uint32_t respawn_ticks;
  std::uint32_t kills;
  std::uint32_t deaths;
  std::uint32_t hits;
  std::uint32_t shots;

  std::uint32_t team_score[3]; // indexed by Team
  std::uint32_t player_count;
  std::uint32_t event_count;
  PlayerSnapshot players[kMaxPlayers];
  SimEvent events[kMaxEvents];
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
// planes: (nx, ny, nz, d) quads; interior is dot(n, x) <= d. Returns 0 on failure.
int sim_add_brush(const float* planes, std::uint32_t plane_count,
                  std::uint32_t material);
void sim_world_finalize();
// World ray cast. out_hit receives [fraction, end xyz, normal xyz]; returns 0 on
// miss. Used by the client's map light bake so lighting matches collision.
int sim_trace_ray(float start_x, float start_y, float start_z, float end_x,
                  float end_y, float end_z, float* out_hit);

// Spawn points the match uses to place everyone. team is cs::Team; TeamNone
// means "usable by anyone".
void sim_add_spawn(float x, float y, float z, float yaw, std::uint32_t team);
// Reset scores, create `bot_count` bots and place every player. `skill` runs
// 0..2 continuously — 0 easy, 1 normal, 2 hard, and anything between those is
// interpolated, so difficulty is a dial rather than three presets.
void sim_start_match(std::uint32_t mode, std::uint32_t bot_count, float skill);
// Place a bot explicitly. Returns its player index, or kMaxPlayers if full.
std::uint32_t sim_add_bot(float x, float y, float z, float yaw,
                          std::uint32_t team, float skill);
// Teleport the local player. Dev/tooling hook (?spawn=, mapcheck drop probes).
void sim_spawn(float x, float y, float z, float yaw);

void sim_step(float forward, float strafe, float yaw, float pitch,
              std::uint32_t buttons, std::uint32_t weapon);
const cs::SimSnapshot* sim_snapshot();
std::uint32_t sim_snapshot_bytes();
}
