#include "cs/sim.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>

namespace cs {
namespace {

constexpr float kTraceEpsilon = 0.0001F;
constexpr float kStopEpsilon = 0.1F;
constexpr float kStaminaValue = 1315.789429F;
constexpr float kBhopFactor = 1.7F;
constexpr float kBhopSlowdown = 0.65F;

constexpr std::array<BoxDefinition, 21> kAimArenaBoxes{{
  {{-800.0F, -16.0F, -600.0F}, {800.0F, 0.0F, 600.0F}, MaterialSand},
  {{-816.0F, 0.0F, -616.0F}, {-800.0F, 256.0F, 616.0F}, MaterialConcrete},
  {{800.0F, 0.0F, -616.0F}, {816.0F, 256.0F, 616.0F}, MaterialConcrete},
  {{-800.0F, 0.0F, -616.0F}, {800.0F, 256.0F, -600.0F}, MaterialConcrete},
  {{-800.0F, 0.0F, 600.0F}, {800.0F, 256.0F, 616.0F}, MaterialConcrete},
  {{-112.0F, 0.0F, -12.0F}, {112.0F, 92.0F, 12.0F}, MaterialWood},
  {{-352.0F, 0.0F, 160.0F}, {-288.0F, 64.0F, 224.0F}, MaterialWood},
  {{288.0F, 0.0F, 160.0F}, {352.0F, 64.0F, 224.0F}, MaterialWood},
  {{-340.0F, 0.0F, -96.0F}, {-260.0F, 48.0F, -16.0F}, MaterialConcrete},
  {{260.0F, 0.0F, -96.0F}, {340.0F, 48.0F, -16.0F}, MaterialConcrete},
  {{-620.0F, 0.0F, -240.0F}, {-460.0F, 48.0F, -80.0F}, MaterialConcrete},
  {{460.0F, 0.0F, 80.0F}, {620.0F, 16.0F, 140.0F}, MaterialConcrete},
  {{460.0F, 0.0F, 20.0F}, {620.0F, 32.0F, 80.0F}, MaterialConcrete},
  {{460.0F, 0.0F, -40.0F}, {620.0F, 48.0F, 20.0F}, MaterialConcrete},
  {{460.0F, 0.0F, -200.0F}, {620.0F, 48.0F, -40.0F}, MaterialConcrete},
  {{-800.0F, 0.0F, -316.0F}, {-64.0F, 144.0F, -300.0F}, MaterialConcrete},
  {{64.0F, 0.0F, -316.0F}, {800.0F, 144.0F, -300.0F}, MaterialConcrete},
  {{-224.0F, 0.0F, -472.0F}, {-152.0F, 72.0F, -400.0F}, MaterialWood},
  {{152.0F, 0.0F, -472.0F}, {224.0F, 72.0F, -400.0F}, MaterialWood},
  {{-96.0F, 0.0F, 336.0F}, {96.0F, 32.0F, 368.0F}, MaterialMetal},
  {{-720.0F, 0.0F, 300.0F}, {-656.0F, 58.0F, 364.0F}, MaterialWood},
}};

constexpr std::array<RampDefinition, 1> kAimArenaRamps{{
  {-620.0F, -460.0F, -80.0F, 120.0F, 0.0F, 48.0F, MaterialConcrete},
}};

constexpr std::array<Vec3, 2> kAimArenaSpawns{{
  {0.0F, kStandingHalfHeight, 500.0F},
  {0.0F, kStandingHalfHeight, -500.0F},
}};

struct Trace {
  float fraction = 1.0F;
  Vec3 end{};
  Vec3 normal{};
  bool start_solid = false;
};

float horizontal_speed(Vec3 velocity) {
  return std::sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

float dot(Vec3 a, Vec3 b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 add(Vec3 a, Vec3 b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 subtract(Vec3 a, Vec3 b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 scale(Vec3 value, float amount) {
  return {value.x * amount, value.y * amount, value.z * amount};
}

Vec3 cross(Vec3 a, Vec3 b) {
  return {
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  };
}

Vec3 hull_extents(const PlayerState& player) {
  return {
    kHullRadius,
    player.ducked ? kDuckedHalfHeight : kStandingHalfHeight,
    kHullRadius,
  };
}

bool overlaps_hull(const Simulation& simulation, Vec3 origin, Vec3 extents) {
  for (std::uint32_t index = 0; index < simulation.solid_count; ++index) {
    const Solid& solid = simulation.solids[index];
    bool inside = true;
    for (std::uint32_t plane_index = 0; plane_index < solid.plane_count; ++plane_index) {
      const Plane& plane = solid.planes[plane_index];
      const float offset =
        std::fabs(plane.normal.x) * extents.x +
        std::fabs(plane.normal.y) * extents.y +
        std::fabs(plane.normal.z) * extents.z;
      if (dot(origin, plane.normal) - (plane.distance + offset) >= -kTraceEpsilon) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}

Trace trace_hull(
  const Simulation& simulation,
  Vec3 start,
  Vec3 end,
  Vec3 extents
) {
  Trace best{};
  best.end = end;
  const Vec3 delta = subtract(end, start);

  for (std::uint32_t index = 0; index < simulation.solid_count; ++index) {
    const Solid& solid = simulation.solids[index];
    float enter = -std::numeric_limits<float>::infinity();
    float exit = 1.0F;
    Vec3 enter_normal{};
    bool separated = false;
    bool strictly_inside = true;

    for (std::uint32_t plane_index = 0; plane_index < solid.plane_count; ++plane_index) {
      const Plane& plane = solid.planes[plane_index];
      const float offset =
        std::fabs(plane.normal.x) * extents.x +
        std::fabs(plane.normal.y) * extents.y +
        std::fabs(plane.normal.z) * extents.z;
      const float expanded_distance = plane.distance + offset;
      const float start_distance = dot(start, plane.normal) - expanded_distance;
      const float end_distance = dot(end, plane.normal) - expanded_distance;

      if (start_distance >= -kTraceEpsilon) strictly_inside = false;
      if (start_distance > 0.0F && end_distance > 0.0F) {
        separated = true;
        break;
      }
      if (start_distance >= 0.0F && end_distance < start_distance) {
        const float fraction =
          (start_distance - kTraceEpsilon) / (start_distance - end_distance);
        if (fraction > enter) {
          enter = fraction;
          enter_normal = plane.normal;
        }
      } else if (start_distance <= 0.0F && end_distance > start_distance) {
        const float fraction =
          (start_distance + kTraceEpsilon) / (start_distance - end_distance);
        exit = std::min(exit, fraction);
      }
    }

    if (strictly_inside) {
      best.fraction = 0.0F;
      best.end = start;
      best.start_solid = true;
      return best;
    }

    if (
      separated ||
      enter >= exit ||
      enter < -kTraceEpsilon ||
      enter > 1.0F ||
      enter >= best.fraction
    ) {
      continue;
    }

    best.fraction = std::max(0.0F, enter);
    best.end = add(start, scale(delta, best.fraction));
    best.normal = enter_normal;
  }

  return best;
}

Vec3 clip_velocity(Vec3 velocity, Vec3 normal) {
  const float backoff = dot(velocity, normal);
  Vec3 result = subtract(velocity, scale(normal, backoff));
  if (std::fabs(result.x) < kStopEpsilon) result.x = 0.0F;
  if (std::fabs(result.y) < kStopEpsilon) result.y = 0.0F;
  if (std::fabs(result.z) < kStopEpsilon) result.z = 0.0F;
  return result;
}

void slide_move(Simulation& simulation, float seconds, Vec3 extents) {
  std::array<Vec3, 5> planes{};
  int plane_count = 0;
  float time_left = seconds;
  const Vec3 primal_velocity = simulation.player.velocity;

  for (int bump = 0; bump < 4; ++bump) {
    if (dot(simulation.player.velocity, simulation.player.velocity) < 0.000001F) {
      break;
    }

    const Vec3 end = add(
      simulation.player.origin,
      scale(simulation.player.velocity, time_left)
    );
    const Trace trace = trace_hull(
      simulation,
      simulation.player.origin,
      end,
      extents
    );
    if (trace.start_solid) {
      simulation.player.velocity = {};
      return;
    }
    if (trace.fraction > 0.0F) {
      simulation.player.origin = trace.end;
    }
    if (trace.fraction >= 1.0F) {
      break;
    }

    time_left *= 1.0F - trace.fraction;
    if (plane_count == static_cast<int>(planes.size())) {
      simulation.player.velocity = {};
      break;
    }
    planes[plane_count++] = trace.normal;

    Vec3 clipped = simulation.player.velocity;
    for (int plane = 0; plane < plane_count; ++plane) {
      if (dot(clipped, planes[plane]) < 0.0F) {
        clipped = clip_velocity(clipped, planes[plane]);
      }
    }

    bool still_blocked = false;
    for (int plane = 0; plane < plane_count; ++plane) {
      if (dot(clipped, planes[plane]) < -kStopEpsilon) {
        still_blocked = true;
        break;
      }
    }
    if (still_blocked && plane_count >= 2) {
      Vec3 crease = cross(planes[plane_count - 2], planes[plane_count - 1]);
      const float crease_length = std::sqrt(dot(crease, crease));
      if (crease_length > 0.000001F) {
        crease = scale(crease, 1.0F / crease_length);
        clipped = scale(crease, dot(primal_velocity, crease));
      } else {
        clipped = {};
      }
    }
    if (dot(clipped, primal_velocity) <= 0.0F) {
      simulation.player.velocity = {};
      break;
    }
    simulation.player.velocity = clipped;
  }
}

void step_slide_move(Simulation& simulation, float seconds, Vec3 extents) {
  const Vec3 start_origin = simulation.player.origin;
  const Vec3 start_velocity = simulation.player.velocity;

  slide_move(simulation, seconds, extents);
  const Vec3 down_origin = simulation.player.origin;
  const Vec3 down_velocity = simulation.player.velocity;

  simulation.player.origin = start_origin;
  simulation.player.velocity = start_velocity;
  const Trace up = trace_hull(
    simulation,
    start_origin,
    add(start_origin, {0.0F, kStepHeight, 0.0F}),
    extents
  );
  if (up.start_solid || up.fraction < 1.0F) {
    simulation.player.origin = down_origin;
    simulation.player.velocity = down_velocity;
    return;
  }

  simulation.player.origin = up.end;
  slide_move(simulation, seconds, extents);
  const Trace down = trace_hull(
    simulation,
    simulation.player.origin,
    add(simulation.player.origin, {0.0F, -kStepHeight, 0.0F}),
    extents
  );
  if (!down.start_solid && down.normal.y > 0.7F) {
    simulation.player.origin = down.end;
  }

  const float down_distance =
    (down_origin.x - start_origin.x) * (down_origin.x - start_origin.x) +
    (down_origin.z - start_origin.z) * (down_origin.z - start_origin.z);
  const float step_distance =
    (simulation.player.origin.x - start_origin.x) *
      (simulation.player.origin.x - start_origin.x) +
    (simulation.player.origin.z - start_origin.z) *
      (simulation.player.origin.z - start_origin.z);
  if (down_distance >= step_distance) {
    simulation.player.origin = down_origin;
    simulation.player.velocity = down_velocity;
  } else {
    simulation.player.velocity.y = down_velocity.y;
  }
}

void categorize_ground(Simulation& simulation) {
  if (simulation.player.velocity.y > 180.0F) {
    simulation.player.on_ground = false;
    return;
  }
  const Trace trace = trace_hull(
    simulation,
    simulation.player.origin,
    add(simulation.player.origin, {0.0F, -2.0F, 0.0F}),
    hull_extents(simulation.player)
  );
  simulation.player.on_ground =
    !trace.start_solid && trace.fraction < 1.0F && trace.normal.y > 0.7F;
  if (simulation.player.on_ground) {
    simulation.player.origin = trace.end;
    if (simulation.player.velocity.y < 0.0F) simulation.player.velocity.y = 0.0F;
  }
}

void update_duck(Simulation& simulation, bool wants_duck) {
  PlayerState& player = simulation.player;
  if (wants_duck && !player.ducked) {
    if (player.on_ground) player.origin.y -= kStandingHalfHeight - kDuckedHalfHeight;
    player.ducked = true;
    return;
  }
  if (!wants_duck && player.ducked) {
    Vec3 candidate = player.origin;
    if (player.on_ground) candidate.y += kStandingHalfHeight - kDuckedHalfHeight;
    const Vec3 standing_extents{kHullRadius, kStandingHalfHeight, kHullRadius};
    if (!overlaps_hull(simulation, candidate, standing_extents)) {
      player.origin = candidate;
      player.ducked = false;
    }
  }
}

float stamina_factor(float stamina) {
  return std::clamp((100.0F - stamina * 0.019F) * 0.01F, 0.0F, 1.0F);
}

void apply_friction(PlayerState& player) {
  const float speed = horizontal_speed(player.velocity);
  if (speed < 1.0F) {
    player.velocity.x = 0.0F;
    player.velocity.z = 0.0F;
    return;
  }
  const float control = std::max(speed, kStopSpeed);
  const float new_speed = std::max(0.0F, speed - control * kFriction * kTickSeconds);
  const float ratio = new_speed / speed;
  player.velocity.x *= ratio;
  player.velocity.z *= ratio;
}

void accelerate(PlayerState& player, Vec3 wish_direction, float wish_speed) {
  const float current_speed = dot(player.velocity, wish_direction);
  const float add_speed = wish_speed - current_speed;
  if (add_speed <= 0.0F) return;
  const float acceleration = std::min(
    add_speed,
    kGroundAccelerate * kTickSeconds * wish_speed
  );
  player.velocity = add(player.velocity, scale(wish_direction, acceleration));
}

void air_accelerate(PlayerState& player, Vec3 wish_direction, float wish_speed) {
  const float capped_speed = std::min(wish_speed, kAirWishSpeedCap);
  const float current_speed = dot(player.velocity, wish_direction);
  const float add_speed = capped_speed - current_speed;
  if (add_speed <= 0.0F) return;
  const float acceleration = std::min(
    add_speed,
    kAirAccelerate * wish_speed * kTickSeconds
  );
  player.velocity = add(player.velocity, scale(wish_direction, acceleration));
}

void update_snapshot(Simulation& simulation) {
  simulation.snapshot = {
    .api_version = kSimApiVersion,
    .tick = simulation.tick,
    .player_origin = simulation.player.origin,
    .player_velocity = simulation.player.velocity,
    .view_height = simulation.player.ducked ? 12.0F : 28.0F,
    .stamina = simulation.player.stamina,
    .horizontal_speed = horizontal_speed(simulation.player.velocity),
    .player_flags =
      (simulation.player.on_ground ? PlayerOnGround : 0U) |
      (simulation.player.ducked ? PlayerDucked : 0U),
  };
}

void hash_word(std::uint64_t& hash, std::uint32_t word) {
  for (int byte = 0; byte < 4; ++byte) {
    hash ^= static_cast<std::uint8_t>(word >> (byte * 8));
    hash *= 1099511628211ULL;
  }
}

}  // namespace

void initialize(Simulation& simulation) {
  simulation = {};
  load_aim_arena(simulation);
  set_player(simulation, kAimArenaSpawns[0]);
}

void load_aim_lab(Simulation& simulation) {
  clear_world(simulation);
  add_solid(simulation, {-336.0F, -16.0F, -256.0F}, {336.0F, 0.0F, 256.0F});
  add_solid(simulation, {-352.0F, 0.0F, -272.0F}, {-336.0F, 144.0F, 272.0F});
  add_solid(simulation, {336.0F, 0.0F, -272.0F}, {352.0F, 144.0F, 272.0F});
  add_solid(simulation, {-336.0F, 0.0F, -272.0F}, {336.0F, 144.0F, -256.0F});
  add_solid(simulation, {-336.0F, 0.0F, 256.0F}, {336.0F, 144.0F, 272.0F});
  add_solid(simulation, {-48.0F, 0.0F, -24.0F}, {48.0F, 16.0F, 40.0F}, MaterialWood);
  add_solid(simulation, {-152.0F, 0.0F, -88.0F}, {-104.0F, 48.0F, -40.0F}, MaterialWood);
  add_solid(simulation, {104.0F, 0.0F, 40.0F}, {152.0F, 48.0F, 88.0F}, MaterialWood);
}

void load_aim_arena(Simulation& simulation) {
  clear_world(simulation);
  for (const BoxDefinition& box : kAimArenaBoxes) {
    add_solid(simulation, box.mins, box.maxs, box.material);
  }
  for (const RampDefinition& ramp : kAimArenaRamps) {
    add_ramp(simulation, ramp);
  }
}

void clear_world(Simulation& simulation) {
  simulation.solid_count = 0;
}

bool add_solid(Simulation& simulation, Vec3 mins, Vec3 maxs, std::uint32_t material) {
  const std::array<Plane, 6> planes{{
    {{1.0F, 0.0F, 0.0F}, maxs.x},
    {{-1.0F, 0.0F, 0.0F}, -mins.x},
    {{0.0F, 1.0F, 0.0F}, maxs.y},
    {{0.0F, -1.0F, 0.0F}, -mins.y},
    {{0.0F, 0.0F, 1.0F}, maxs.z},
    {{0.0F, 0.0F, -1.0F}, -mins.z},
  }};
  return add_convex_solid(simulation, planes, material);
}

bool add_convex_solid(
  Simulation& simulation,
  std::span<const Plane> planes,
  std::uint32_t material
) {
  if (
    simulation.solid_count >= kMaxSolids ||
    planes.empty() ||
    planes.size() > kMaxBrushPlanes
  ) {
    return false;
  }
  Solid& solid = simulation.solids[simulation.solid_count++];
  solid = {};
  solid.plane_count = static_cast<std::uint32_t>(planes.size());
  solid.material = material;
  std::copy(planes.begin(), planes.end(), solid.planes.begin());
  return true;
}

bool add_ramp(Simulation& simulation, const RampDefinition& ramp) {
  const float depth = ramp.max_z - ramp.min_z;
  if (depth <= 0.0F || ramp.max_x <= ramp.min_x || ramp.height <= 0.0F) {
    return false;
  }
  const float slope = ramp.height / depth;
  const float normal_length = std::sqrt(1.0F + slope * slope);
  const Vec3 top_normal{0.0F, 1.0F / normal_length, slope / normal_length};
  const float top_distance =
    (ramp.base_y + slope * ramp.max_z) / normal_length;
  const std::array<Plane, 6> planes{{
    {{1.0F, 0.0F, 0.0F}, ramp.max_x},
    {{-1.0F, 0.0F, 0.0F}, -ramp.min_x},
    {{0.0F, 0.0F, 1.0F}, ramp.max_z},
    {{0.0F, 0.0F, -1.0F}, -ramp.min_z},
    {{0.0F, -1.0F, 0.0F}, -ramp.base_y},
    {top_normal, top_distance},
  }};
  return add_convex_solid(simulation, planes, ramp.material);
}

std::span<const BoxDefinition> aim_arena_boxes() {
  return kAimArenaBoxes;
}

std::span<const RampDefinition> aim_arena_ramps() {
  return kAimArenaRamps;
}

std::span<const Vec3> aim_arena_spawns() {
  return kAimArenaSpawns;
}

void set_player(Simulation& simulation, Vec3 origin, Vec3 velocity) {
  simulation.player = {
    .origin = origin,
    .velocity = velocity,
    .yaw = 0.0F,
    .stamina = 0.0F,
    .on_ground = false,
    .ducked = false,
    .jump_held = false,
  };
  categorize_ground(simulation);
  update_snapshot(simulation);
}

void step(Simulation& simulation, const InputCommand& command) {
  PlayerState& player = simulation.player;
  player.yaw = command.yaw;
  player.stamina = std::max(0.0F, player.stamina - kTickSeconds * 1000.0F);

  categorize_ground(simulation);
  update_duck(simulation, (command.buttons & ButtonDuck) != 0U);
  categorize_ground(simulation);

  const float raw_length = std::sqrt(
    command.forward * command.forward + command.strafe * command.strafe
  );
  const float input_scale = raw_length > 1.0F ? 1.0F / raw_length : 1.0F;
  const float forward_input = command.forward * input_scale;
  const float strafe_input = command.strafe * input_scale;
  const Vec3 forward{std::sin(player.yaw), 0.0F, -std::cos(player.yaw)};
  const Vec3 right{std::cos(player.yaw), 0.0F, std::sin(player.yaw)};
  Vec3 wish_velocity = add(scale(forward, forward_input), scale(right, strafe_input));
  const float wish_length = std::sqrt(dot(wish_velocity, wish_velocity));
  Vec3 wish_direction{};
  if (wish_length > 0.000001F) wish_direction = scale(wish_velocity, 1.0F / wish_length);

  const bool jump_pressed = (command.buttons & ButtonJump) != 0U;
  if (jump_pressed && !player.jump_held && player.on_ground) {
    const float speed = horizontal_speed(player.velocity);
    const float threshold = kBhopFactor * kRunSpeed;
    if (speed > threshold) {
      const float target = threshold * kBhopSlowdown;
      player.velocity.x *= target / speed;
      player.velocity.z *= target / speed;
    }
    player.velocity.y = kJumpImpulse * stamina_factor(player.stamina);
    player.stamina = kStaminaValue;
    player.on_ground = false;
  }

  if (player.on_ground) {
    apply_friction(player);
    float max_speed = kRunSpeed * stamina_factor(player.stamina);
    if (player.ducked) max_speed *= 0.333F;
    if (wish_length > 0.0F) accelerate(player, wish_direction, max_speed * wish_length);
    player.velocity.y = 0.0F;
    step_slide_move(simulation, kTickSeconds, hull_extents(player));
  } else {
    if (wish_length > 0.0F) {
      air_accelerate(player, wish_direction, kRunSpeed * wish_length);
    }
    player.velocity.y -= kGravity * kTickSeconds;
    slide_move(simulation, kTickSeconds, hull_extents(player));
  }

  categorize_ground(simulation);
  player.jump_held = jump_pressed;
  ++simulation.tick;
  update_snapshot(simulation);
}

std::uint64_t state_hash(const Simulation& simulation) {
  std::uint64_t hash = 1469598103934665603ULL;
  hash_word(hash, simulation.tick);
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.origin.x));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.origin.y));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.origin.z));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.velocity.x));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.velocity.y));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.velocity.z));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.yaw));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.player.stamina));
  hash_word(hash, simulation.player.on_ground ? 1U : 0U);
  hash_word(hash, simulation.player.ducked ? 1U : 0U);
  hash_word(hash, simulation.player.jump_held ? 1U : 0U);
  return hash;
}

}  // namespace cs

namespace {

cs::Simulation default_simulation{};

}  // namespace

extern "C" std::uint32_t sim_create() {
  cs::initialize(default_simulation);
  return cs::kSimApiVersion;
}

extern "C" void sim_step(const cs::InputCommand* command) {
  if (command != nullptr) cs::step(default_simulation, *command);
}

extern "C" const cs::SimSnapshot* sim_snapshot() {
  return &default_simulation.snapshot;
}
