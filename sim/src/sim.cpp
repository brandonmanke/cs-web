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

constexpr std::array<WeaponDefinition, kWeaponCount> kWeapons{{
  {WeaponNone, "None", 0, 0, 0.0F, 1.0F, 0.0F, 0.0F, 0.0F, kRunSpeed, 1, 1, 0, false},
  {WeaponKnife, "Knife", 0, 0, 55.0F, 1.0F, 0.0F, 0.0F, 0.0F, 250.0F, 25, 1, 0, true},
  {WeaponUsp, "USP", 12, 100, 34.0F, 0.79F, 18.0F, 0.0045F, 0.72F, 250.0F, 10, 140, 1, false},
  {WeaponGlock, "Glock", 20, 120, 25.0F, 0.75F, 15.0F, 0.0060F, 0.62F, 250.0F, 9, 145, 1, false},
  {WeaponAk47, "AK-47", 30, 90, 36.0F, 0.80F, 36.0F, 0.0070F, 1.00F, 221.0F, 6, 160, 2, true},
  {WeaponM4a1, "M4A1", 30, 90, 33.0F, 0.82F, 32.0F, 0.0055F, 0.82F, 230.0F, 6, 165, 2, true},
  {WeaponAwp, "AWP", 10, 30, 115.0F, 0.99F, 45.0F, 0.0015F, 1.18F, 210.0F, 95, 235, 2, false},
  {WeaponMp5, "MP5", 30, 120, 26.0F, 0.84F, 21.0F, 0.0090F, 0.44F, 250.0F, 5, 150, 1, true},
}};

constexpr std::array<Vec2, 30> kRiflePattern{{
  { 0.000F, 0.000F}, { 0.001F, 0.010F}, { 0.003F, 0.021F},
  { 0.005F, 0.033F}, { 0.008F, 0.045F}, { 0.010F, 0.057F},
  { 0.012F, 0.068F}, { 0.010F, 0.078F}, { 0.006F, 0.086F},
  { 0.000F, 0.092F}, {-0.008F, 0.097F}, {-0.017F, 0.101F},
  {-0.027F, 0.104F}, {-0.037F, 0.106F}, {-0.045F, 0.107F},
  {-0.050F, 0.107F}, {-0.048F, 0.106F}, {-0.041F, 0.104F},
  {-0.031F, 0.101F}, {-0.018F, 0.098F}, {-0.004F, 0.095F},
  { 0.010F, 0.093F}, { 0.024F, 0.091F}, { 0.036F, 0.090F},
  { 0.045F, 0.090F}, { 0.048F, 0.091F}, { 0.044F, 0.093F},
  { 0.035F, 0.096F}, { 0.022F, 0.100F}, { 0.008F, 0.104F},
}};

struct Hitbox {
  Vec3 mins;
  Vec3 maxs;
  HitGroup group;
};

constexpr std::array<Hitbox, 4> kTargetHitboxes{{
  {{-6.0F, 58.0F, -6.0F}, {6.0F, 72.0F, 6.0F}, HitHead},
  {{-12.0F, 38.0F, -7.0F}, {12.0F, 58.0F, 7.0F}, HitChest},
  {{-11.0F, 26.0F, -7.0F}, {11.0F, 38.0F, 7.0F}, HitStomach},
  {{-14.0F, 0.0F, -6.0F}, {14.0F, 26.0F, 6.0F}, HitLimbs},
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

Vec3 normalize(Vec3 value) {
  const float length = std::sqrt(dot(value, value));
  if (length <= 0.000001F) return {};
  return scale(value, 1.0F / length);
}

std::uint32_t random_word(std::uint32_t& state) {
  state ^= state << 13U;
  state ^= state >> 17U;
  state ^= state << 5U;
  return state;
}

float random_signed(std::uint32_t& state) {
  return static_cast<float>(random_word(state) & 0x00FFFFFFU) /
    static_cast<float>(0x007FFFFFU) - 1.0F;
}

bool ray_aabb(
  Vec3 origin,
  Vec3 direction,
  Vec3 mins,
  Vec3 maxs,
  float max_distance,
  float& distance
) {
  float enter = 0.0F;
  float exit = max_distance;
  const std::array<float, 3> origins{{origin.x, origin.y, origin.z}};
  const std::array<float, 3> directions{{direction.x, direction.y, direction.z}};
  const std::array<float, 3> minimums{{mins.x, mins.y, mins.z}};
  const std::array<float, 3> maximums{{maxs.x, maxs.y, maxs.z}};
  for (int axis = 0; axis < 3; ++axis) {
    if (std::fabs(directions[axis]) < 0.000001F) {
      if (origins[axis] < minimums[axis] || origins[axis] > maximums[axis]) {
        return false;
      }
      continue;
    }
    float first = (minimums[axis] - origins[axis]) / directions[axis];
    float second = (maximums[axis] - origins[axis]) / directions[axis];
    if (first > second) std::swap(first, second);
    enter = std::max(enter, first);
    exit = std::min(exit, second);
    if (enter > exit) return false;
  }
  distance = enter;
  return enter <= max_distance && exit >= 0.0F;
}

bool ray_brush(
  const Solid& solid,
  Vec3 origin,
  Vec3 direction,
  float max_distance,
  float& enter,
  float& exit
) {
  enter = 0.0F;
  exit = max_distance;
  for (std::uint32_t plane_index = 0; plane_index < solid.plane_count; ++plane_index) {
    const Plane& plane = solid.planes[plane_index];
    const float origin_distance = dot(origin, plane.normal) - plane.distance;
    const float direction_dot = dot(direction, plane.normal);
    if (std::fabs(direction_dot) < 0.000001F) {
      if (origin_distance > 0.0F) return false;
      continue;
    }
    const float distance = -origin_distance / direction_dot;
    if (direction_dot < 0.0F) {
      enter = std::max(enter, distance);
    } else {
      exit = std::min(exit, distance);
    }
    if (enter > exit) return false;
  }
  return exit >= 0.0F && enter <= max_distance;
}

struct TargetHit {
  float distance = std::numeric_limits<float>::infinity();
  std::uint32_t target_index = 0;
  HitGroup group = HitNone;
};

TargetHit trace_targets(
  const Simulation& simulation,
  Vec3 origin,
  Vec3 direction,
  float max_distance
) {
  TargetHit best{};
  for (std::uint32_t target_index = 0; target_index < simulation.target_count; ++target_index) {
    const TargetState& target = simulation.targets[target_index];
    if (!target.alive) continue;
    for (const Hitbox& hitbox : kTargetHitboxes) {
      float distance = 0.0F;
      if (!ray_aabb(
        origin,
        direction,
        add(target.origin, hitbox.mins),
        add(target.origin, hitbox.maxs),
        max_distance,
        distance
      )) {
        continue;
      }
      if (distance < best.distance) {
        best = {distance, target_index, hitbox.group};
      }
    }
  }
  return best;
}

float material_entry_loss(std::uint32_t material) {
  switch (material) {
    case MaterialWood: return 4.0F;
    case MaterialMetal: return 18.0F;
    case MaterialSand: return 6.0F;
    default: return 12.0F;
  }
}

float material_thickness_scale(std::uint32_t material) {
  switch (material) {
    case MaterialWood: return 0.25F;
    case MaterialMetal: return 1.50F;
    case MaterialSand: return 0.50F;
    default: return 1.00F;
  }
}

Vec3 shot_direction(
  const Simulation& simulation,
  const WeaponDefinition& definition,
  std::uint32_t sequence,
  float yaw,
  float pitch
) {
  const Vec2 pattern = weapon_pattern_offset(
    definition.id,
    simulation.weapon.shot_index
  );
  float spread = definition.spread;
  if (simulation.weapon.shot_index == 0 && horizontal_speed(simulation.player.velocity) < 5.0F) {
    spread = 0.0F;
  } else {
    spread += std::min(0.035F, horizontal_speed(simulation.player.velocity) / 10000.0F);
    if (!simulation.player.on_ground) spread += 0.065F;
    if (simulation.player.ducked) spread *= 0.72F;
  }
  std::uint32_t random_state = sequence * 747796405U +
    static_cast<std::uint32_t>(definition.id) * 2891336453U + 277803737U;
  const float yaw_offset = pattern.x + random_signed(random_state) * spread;
  const float pitch_offset = pattern.y + random_signed(random_state) * spread;
  const float pitch_cosine = std::cos(pitch);
  const Vec3 forward{
    std::sin(yaw) * pitch_cosine,
    std::sin(pitch),
    -std::cos(yaw) * pitch_cosine,
  };
  const Vec3 right{std::cos(yaw), 0.0F, std::sin(yaw)};
  const Vec3 up = cross(right, forward);
  return normalize(add(add(forward, scale(right, yaw_offset)), scale(up, pitch_offset)));
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

struct SurfaceSegment {
  float enter;
  float exit;
  std::uint32_t material;
};

void record_dry_fire(Simulation& simulation) {
  simulation.last_shot = {
    .sequence = ++simulation.weapon.shot_sequence,
    .result = ShotDry,
    .target_index = kMaxTargets,
    .start = add(
      simulation.player.origin,
      {0.0F, simulation.player.ducked ? 12.0F : 28.0F, 0.0F}
    ),
  };
}

void fire_shot(Simulation& simulation, float yaw, float pitch) {
  WeaponState& weapon = simulation.weapon;
  const WeaponDefinition& definition = weapon_definition(weapon.selected);
  const std::uint32_t sequence = ++weapon.shot_sequence;
  const Vec3 start = add(
    simulation.player.origin,
    {0.0F, simulation.player.ducked ? 12.0F : 28.0F, 0.0F}
  );
  const Vec3 direction = shot_direction(
    simulation,
    definition,
    sequence,
    yaw,
    pitch
  );
  const float max_distance = weapon.selected == WeaponKnife ? 64.0F : 4096.0F;
  const TargetHit target_hit = trace_targets(
    simulation,
    start,
    direction,
    max_distance
  );

  simulation.last_shot = {
    .sequence = sequence,
    .result = ShotMiss,
    .target_index = kMaxTargets,
    .start = start,
    .end = add(start, scale(direction, max_distance)),
  };

  std::array<SurfaceSegment, kMaxSolids> surfaces{};
  std::uint32_t surface_count = 0;
  float nearest_world = max_distance;
  std::uint32_t nearest_material = MaterialConcrete;
  const float trace_distance = std::min(max_distance, target_hit.distance);
  for (std::uint32_t solid_index = 0; solid_index < simulation.solid_count; ++solid_index) {
    float enter = 0.0F;
    float exit = 0.0F;
    const Solid& solid = simulation.solids[solid_index];
    if (!ray_brush(solid, start, direction, trace_distance, enter, exit)) {
      continue;
    }
    enter = std::max(0.0F, enter);
    exit = std::max(enter, exit);
    if (enter < nearest_world) {
      nearest_world = enter;
      nearest_material = solid.material;
    }
    if (target_hit.group != HitNone && enter < target_hit.distance) {
      surfaces[surface_count++] = {enter, exit, solid.material};
    }
  }

  if (target_hit.group == HitNone) {
    if (nearest_world < max_distance) {
      simulation.last_shot.result = ShotWorld;
      simulation.last_shot.material = nearest_material;
      simulation.last_shot.end = add(start, scale(direction, nearest_world));
    }
  } else {
    std::sort(
      surfaces.begin(),
      surfaces.begin() + surface_count,
      [](const SurfaceSegment& first, const SurfaceSegment& second) {
        return first.enter < second.enter;
      }
    );
    float damage = definition.base_damage * std::pow(
      definition.range_modifier,
      target_hit.distance / 500.0F
    );
    std::uint32_t penetrations = 0;
    bool blocked = false;
    for (std::uint32_t index = 0; index < surface_count; ++index) {
      const SurfaceSegment& surface = surfaces[index];
      if (
        definition.penetration_power <= 0.0F ||
        penetrations >= definition.max_penetrations
      ) {
        simulation.last_shot.result = ShotWorld;
        simulation.last_shot.material = surface.material;
        simulation.last_shot.end = add(start, scale(direction, surface.enter));
        blocked = true;
        break;
      }
      const float thickness = std::max(0.0F, surface.exit - surface.enter);
      damage -= material_entry_loss(surface.material);
      damage -= thickness * material_thickness_scale(surface.material) *
        (10.0F / definition.penetration_power);
      ++penetrations;
      if (damage <= 0.0F) {
        simulation.last_shot.result = ShotWorld;
        simulation.last_shot.material = surface.material;
        simulation.last_shot.end = add(start, scale(direction, surface.enter));
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      TargetState& target = simulation.targets[target_hit.target_index];
      damage *= hit_group_multiplier(target_hit.group);
      target.health -= damage;
      target.hit_flash_ticks = 8;
      ++simulation.hits;
      simulation.last_shot.result = target.health <= 0.0F ? ShotKill : ShotHit;
      simulation.last_shot.hit_group = target_hit.group;
      simulation.last_shot.target_index = target_hit.target_index;
      simulation.last_shot.penetrations = penetrations;
      simulation.last_shot.damage = damage;
      simulation.last_shot.end = add(start, scale(direction, target_hit.distance));
      if (target.health <= 0.0F) {
        target.health = 0.0F;
        target.alive = false;
        target.respawn_ticks = 64;
        ++simulation.kills;
      }
    }
  }

  const Vec2 pattern = weapon_pattern_offset(weapon.selected, weapon.shot_index);
  weapon.punch_pitch = std::min(
    0.14F,
    weapon.punch_pitch + 0.008F + pattern.y * 0.22F
  );
  weapon.punch_yaw = std::clamp(
    weapon.punch_yaw + pattern.x * 0.16F,
    -0.05F,
    0.05F
  );
}

void update_targets(Simulation& simulation) {
  for (std::uint32_t index = 0; index < simulation.target_count; ++index) {
    TargetState& target = simulation.targets[index];
    if (target.hit_flash_ticks > 0) --target.hit_flash_ticks;
    if (!target.alive) {
      if (target.respawn_ticks > 0) --target.respawn_ticks;
      if (target.respawn_ticks == 0) {
        target.alive = true;
        target.health = 100.0F;
      }
      continue;
    }
    target.origin.x += target.speed * kTickSeconds;
    if (target.origin.x < target.min_x) {
      target.origin.x = target.min_x;
      target.speed = std::fabs(target.speed);
    } else if (target.origin.x > target.max_x) {
      target.origin.x = target.max_x;
      target.speed = -std::fabs(target.speed);
    }
  }
}

void finish_reload(Simulation& simulation) {
  WeaponState& state = simulation.weapon;
  const WeaponDefinition& definition = weapon_definition(state.selected);
  const std::uint32_t index = static_cast<std::uint32_t>(state.selected);
  const std::uint32_t needed = definition.magazine_capacity - state.magazine[index];
  const std::uint32_t transferred = std::min(needed, state.reserve[index]);
  state.magazine[index] += transferred;
  state.reserve[index] -= transferred;
}

void update_weapon(Simulation& simulation, const InputCommand& command) {
  WeaponState& state = simulation.weapon;
  state.punch_pitch *= 0.86F;
  state.punch_yaw *= 0.82F;
  if (state.cooldown_ticks > 0) --state.cooldown_ticks;
  if (state.reload_ticks > 0) {
    --state.reload_ticks;
    if (state.reload_ticks == 0) finish_reload(simulation);
  }

  if (
    command.requested_weapon > WeaponNone &&
    command.requested_weapon < kWeaponCount &&
    command.requested_weapon != state.selected
  ) {
    select_weapon(
      simulation,
      static_cast<WeaponId>(command.requested_weapon)
    );
  }

  const WeaponDefinition& definition = weapon_definition(state.selected);
  const std::uint32_t weapon_index = static_cast<std::uint32_t>(state.selected);
  if (
    (command.buttons & ButtonReload) != 0U &&
    state.reload_ticks == 0 &&
    definition.magazine_capacity > 0 &&
    state.magazine[weapon_index] < definition.magazine_capacity &&
    state.reserve[weapon_index] > 0
  ) {
    state.reload_ticks = definition.reload_ticks;
    state.shot_index = 0;
  }

  const bool fire_pressed = (command.buttons & ButtonFire) != 0U;
  const bool trigger = definition.automatic ? fire_pressed : fire_pressed && !state.fire_held;
  bool fired = false;
  if (trigger && state.cooldown_ticks == 0 && state.reload_ticks == 0) {
    if (definition.magazine_capacity > 0 && state.magazine[weapon_index] == 0) {
      record_dry_fire(simulation);
      state.cooldown_ticks = 8;
    } else {
      if (definition.magazine_capacity > 0) --state.magazine[weapon_index];
      fire_shot(simulation, command.yaw, command.pitch);
      state.cooldown_ticks = definition.fire_ticks;
      state.shot_index = std::min<std::uint32_t>(
        state.shot_index + 1,
        static_cast<std::uint32_t>(kRiflePattern.size() - 1)
      );
      fired = true;
    }
  }
  if (fired) {
    state.recovery_ticks = 0;
  } else if (++state.recovery_ticks > 20) {
    state.shot_index = 0;
  }
  state.fire_held = fire_pressed;
}

void update_snapshot(Simulation& simulation) {
  SimSnapshot snapshot{
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
    .weapon = simulation.weapon.selected,
    .magazine = simulation.weapon.magazine[simulation.weapon.selected],
    .reserve = simulation.weapon.reserve[simulation.weapon.selected],
    .reload_ticks = simulation.weapon.reload_ticks,
    .punch_pitch = simulation.weapon.punch_pitch,
    .punch_yaw = simulation.weapon.punch_yaw,
    .kills = simulation.kills,
    .hits = simulation.hits,
    .last_shot = simulation.last_shot,
    .target_count = simulation.target_count,
  };
  for (std::uint32_t index = 0; index < simulation.target_count; ++index) {
    const TargetState& target = simulation.targets[index];
    snapshot.targets[index] = {
      .origin = target.origin,
      .health = target.health,
      .hit_flash_ticks = target.hit_flash_ticks,
      .alive = target.alive ? 1U : 0U,
    };
  }
  simulation.snapshot = snapshot;
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
  for (const WeaponDefinition& definition : kWeapons) {
    const std::uint32_t index = static_cast<std::uint32_t>(definition.id);
    simulation.weapon.magazine[index] = definition.magazine_capacity;
    simulation.weapon.reserve[index] = definition.reserve_capacity;
  }
  simulation.weapon.selected = WeaponAk47;
  add_target(simulation, {0.0F, 0.0F, 250.0F}, -180.0F, 180.0F, 60.0F);
  add_target(simulation, {280.0F, 0.0F, -160.0F}, 180.0F, 380.0F, -48.0F);
  add_target(simulation, {0.0F, 0.0F, -450.0F}, -48.0F, 48.0F, 36.0F);
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

std::span<const WeaponDefinition> weapon_definitions() {
  return kWeapons;
}

const WeaponDefinition& weapon_definition(WeaponId weapon) {
  const std::uint32_t index = static_cast<std::uint32_t>(weapon);
  if (index >= kWeapons.size()) return kWeapons[WeaponNone];
  return kWeapons[index];
}

Vec2 weapon_pattern_offset(WeaponId weapon, std::uint32_t shot_index) {
  const std::uint32_t index = std::min<std::uint32_t>(
    shot_index,
    static_cast<std::uint32_t>(kRiflePattern.size() - 1)
  );
  const float scale_value = weapon_definition(weapon).pattern_scale;
  return {
    kRiflePattern[index].x * scale_value,
    kRiflePattern[index].y * scale_value,
  };
}

float hit_group_multiplier(HitGroup hit_group) {
  switch (hit_group) {
    case HitHead: return 4.0F;
    case HitStomach: return 1.25F;
    case HitLimbs: return 0.75F;
    default: return 1.0F;
  }
}

void clear_targets(Simulation& simulation) {
  simulation.target_count = 0;
  simulation.kills = 0;
  simulation.hits = 0;
}

bool add_target(
  Simulation& simulation,
  Vec3 origin,
  float min_x,
  float max_x,
  float speed
) {
  if (simulation.target_count >= kMaxTargets || min_x > max_x) return false;
  simulation.targets[simulation.target_count++] = {
    .origin = origin,
    .min_x = min_x,
    .max_x = max_x,
    .speed = speed,
    .health = 100.0F,
    .alive = true,
  };
  return true;
}

void select_weapon(Simulation& simulation, WeaponId weapon, bool immediate) {
  if (weapon <= WeaponNone || weapon >= kWeaponCount) return;
  WeaponState& state = simulation.weapon;
  state.selected = weapon;
  state.cooldown_ticks = immediate ? 0U : 15U;
  state.reload_ticks = 0;
  state.shot_index = 0;
  state.recovery_ticks = 0;
  state.fire_held = false;
  update_snapshot(simulation);
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
    const float weapon_speed = weapon_definition(simulation.weapon.selected).max_move_speed;
    const float threshold = kBhopFactor * weapon_speed;
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
    float max_speed = weapon_definition(simulation.weapon.selected).max_move_speed *
      stamina_factor(player.stamina);
    if (player.ducked) max_speed *= 0.333F;
    if (wish_length > 0.0F) accelerate(player, wish_direction, max_speed * wish_length);
    player.velocity.y = 0.0F;
    step_slide_move(simulation, kTickSeconds, hull_extents(player));
  } else {
    if (wish_length > 0.0F) {
      air_accelerate(
        player,
        wish_direction,
        weapon_definition(simulation.weapon.selected).max_move_speed * wish_length
      );
    }
    player.velocity.y -= kGravity * kTickSeconds;
    slide_move(simulation, kTickSeconds, hull_extents(player));
  }

  categorize_ground(simulation);
  update_targets(simulation);
  update_weapon(simulation, command);
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
  hash_word(hash, simulation.weapon.selected);
  hash_word(hash, simulation.weapon.cooldown_ticks);
  hash_word(hash, simulation.weapon.reload_ticks);
  hash_word(hash, simulation.weapon.shot_index);
  hash_word(hash, simulation.weapon.recovery_ticks);
  hash_word(hash, simulation.weapon.shot_sequence);
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.weapon.punch_pitch));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.weapon.punch_yaw));
  hash_word(hash, simulation.weapon.fire_held ? 1U : 0U);
  for (std::uint32_t index = 0; index < kWeaponCount; ++index) {
    hash_word(hash, simulation.weapon.magazine[index]);
    hash_word(hash, simulation.weapon.reserve[index]);
  }
  hash_word(hash, simulation.target_count);
  hash_word(hash, simulation.kills);
  hash_word(hash, simulation.hits);
  for (std::uint32_t index = 0; index < simulation.target_count; ++index) {
    const TargetState& target = simulation.targets[index];
    hash_word(hash, std::bit_cast<std::uint32_t>(target.origin.x));
    hash_word(hash, std::bit_cast<std::uint32_t>(target.origin.y));
    hash_word(hash, std::bit_cast<std::uint32_t>(target.origin.z));
    hash_word(hash, std::bit_cast<std::uint32_t>(target.speed));
    hash_word(hash, std::bit_cast<std::uint32_t>(target.health));
    hash_word(hash, target.respawn_ticks);
    hash_word(hash, target.hit_flash_ticks);
    hash_word(hash, target.alive ? 1U : 0U);
  }
  hash_word(hash, simulation.last_shot.sequence);
  hash_word(hash, simulation.last_shot.result);
  hash_word(hash, simulation.last_shot.hit_group);
  hash_word(hash, simulation.last_shot.target_index);
  hash_word(hash, simulation.last_shot.material);
  hash_word(hash, simulation.last_shot.penetrations);
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.last_shot.damage));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.last_shot.end.x));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.last_shot.end.y));
  hash_word(hash, std::bit_cast<std::uint32_t>(simulation.last_shot.end.z));
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
