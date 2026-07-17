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

float component(Vec3 value, int axis) {
  if (axis == 0) return value.x;
  if (axis == 1) return value.y;
  return value.z;
}

void set_component(Vec3& value, int axis, float component_value) {
  if (axis == 0) value.x = component_value;
  if (axis == 1) value.y = component_value;
  if (axis == 2) value.z = component_value;
}

bool overlaps_hull(const Simulation& simulation, Vec3 origin, Vec3 extents) {
  for (std::uint32_t index = 0; index < simulation.solid_count; ++index) {
    const Solid& solid = simulation.solids[index];
    if (
      origin.x > solid.mins.x - extents.x + kTraceEpsilon &&
      origin.x < solid.maxs.x + extents.x - kTraceEpsilon &&
      origin.y > solid.mins.y - extents.y + kTraceEpsilon &&
      origin.y < solid.maxs.y + extents.y - kTraceEpsilon &&
      origin.z > solid.mins.z - extents.z + kTraceEpsilon &&
      origin.z < solid.maxs.z + extents.z - kTraceEpsilon
    ) {
      return true;
    }
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
    const Vec3 expanded_mins = subtract(solid.mins, extents);
    const Vec3 expanded_maxs = add(solid.maxs, extents);

    const bool inside =
      start.x > expanded_mins.x + kTraceEpsilon &&
      start.x < expanded_maxs.x - kTraceEpsilon &&
      start.y > expanded_mins.y + kTraceEpsilon &&
      start.y < expanded_maxs.y - kTraceEpsilon &&
      start.z > expanded_mins.z + kTraceEpsilon &&
      start.z < expanded_maxs.z - kTraceEpsilon;
    if (inside) {
      best.fraction = 0.0F;
      best.end = start;
      best.start_solid = true;
      return best;
    }

    float enter = -std::numeric_limits<float>::infinity();
    float exit = std::numeric_limits<float>::infinity();
    Vec3 enter_normal{};
    bool separated = false;

    for (int axis = 0; axis < 3; ++axis) {
      const float start_axis = component(start, axis);
      const float delta_axis = component(delta, axis);
      const float min_axis = component(expanded_mins, axis);
      const float max_axis = component(expanded_maxs, axis);

      if (std::fabs(delta_axis) < 0.000001F) {
        if (start_axis < min_axis || start_axis > max_axis) {
          separated = true;
          break;
        }
        continue;
      }

      float near_time = 0.0F;
      float far_time = 0.0F;
      Vec3 near_normal{};
      if (delta_axis > 0.0F) {
        near_time = (min_axis - start_axis) / delta_axis;
        far_time = (max_axis - start_axis) / delta_axis;
        set_component(near_normal, axis, -1.0F);
      } else {
        near_time = (max_axis - start_axis) / delta_axis;
        far_time = (min_axis - start_axis) / delta_axis;
        set_component(near_normal, axis, 1.0F);
      }

      if (near_time > enter) {
        enter = near_time;
        enter_normal = near_normal;
      }
      exit = std::min(exit, far_time);
      if (enter > exit) {
        separated = true;
        break;
      }
    }

    if (
      separated ||
      enter < -kTraceEpsilon ||
      enter > 1.0F ||
      enter >= best.fraction
    ) {
      continue;
    }

    best.fraction = std::max(0.0F, enter - kTraceEpsilon);
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
  load_aim_lab(simulation);
  set_player(simulation, {0.0F, kStandingHalfHeight, 180.0F});
}

void load_aim_lab(Simulation& simulation) {
  clear_world(simulation);
  add_solid(simulation, {-336.0F, -16.0F, -256.0F}, {336.0F, 0.0F, 256.0F});
  add_solid(simulation, {-352.0F, 0.0F, -272.0F}, {-336.0F, 144.0F, 272.0F});
  add_solid(simulation, {336.0F, 0.0F, -272.0F}, {352.0F, 144.0F, 272.0F});
  add_solid(simulation, {-336.0F, 0.0F, -272.0F}, {336.0F, 144.0F, -256.0F});
  add_solid(simulation, {-336.0F, 0.0F, 256.0F}, {336.0F, 144.0F, 272.0F});
  add_solid(simulation, {-48.0F, 0.0F, -24.0F}, {48.0F, 16.0F, 40.0F}, 1);
  add_solid(simulation, {-152.0F, 0.0F, -88.0F}, {-104.0F, 48.0F, -40.0F}, 1);
  add_solid(simulation, {104.0F, 0.0F, 40.0F}, {152.0F, 48.0F, 88.0F}, 1);
}

void clear_world(Simulation& simulation) {
  simulation.solid_count = 0;
}

bool add_solid(Simulation& simulation, Vec3 mins, Vec3 maxs, std::uint32_t material) {
  if (simulation.solid_count >= kMaxSolids) return false;
  simulation.solids[simulation.solid_count++] = {mins, maxs, material};
  return true;
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
