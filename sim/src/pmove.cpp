#include "state.h"
#include "world.h"

#include <cmath>

// Quake/GoldSrc-style player movement: friction + acceleration toward a wish
// direction, air strafing via the 30 u/s wishspeed cap, slide-along-planes
// collision with step-up. Structure follows the classic PM_* flow; collision
// queries go through world_trace_hull (convex brushes underneath).
//
// Nothing here knows about weapons, teams or who is driving: bots run the exact
// same function with a synthesized InputCommand, which is the only way their
// movement can be trusted to obey the same rules the player's does.

namespace cs {
namespace {

constexpr float kDuckLerpSeconds = 0.25F;
constexpr float kGroundCheckDistance = 2.0F;
constexpr float kJumpingAwaySpeed = 180.0F; // vertical speed above which we never ground
constexpr int kMaxClipPlanes = 5;
constexpr int kMaxBumps = 4;

Vec3 add(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 sub(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 scale(Vec3 v, float s) { return {v.x * s, v.y * s, v.z * s}; }
float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
float length(Vec3 v) { return std::sqrt(dot(v, v)); }

float horizontal_speed(Vec3 v) { return std::sqrt(v.x * v.x + v.z * v.z); }

Vec3 hull_half(const PlayerState& p) {
  return {kHullHalfWidth, p.ducked ? kHullHalfHeightDuck : kHullHalfHeightStand,
          kHullHalfWidth};
}

float stamina_ratio(float stamina) {
  // GoldSrc fuser2: (100 - fuser2 * 0.001 * 19) / 100 -> 0.75 right after a jump
  return (100.0F - stamina * 0.001F * 19.0F) * 0.01F;
}

float current_max_speed(const PlayerState& p, float base, bool walking) {
  if (p.ducked) {
    return base * kDuckSpeedFactor;
  }
  return walking ? base * kWalkSpeedFactor : base;
}

// PM_ClipVelocity: remove the velocity component going into the plane.
Vec3 clip_velocity(Vec3 in, Vec3 normal, float overbounce) {
  constexpr float kStopEpsilon = 0.1F;
  const float backoff = dot(in, normal) * overbounce;
  Vec3 out = sub(in, scale(normal, backoff));
  float* v = &out.x;
  for (int i = 0; i < 3; ++i) {
    if (v[i] > -kStopEpsilon && v[i] < kStopEpsilon) {
      v[i] = 0.0F;
    }
  }
  return out;
}

void apply_friction(PlayerState& p) {
  const float speed = horizontal_speed(p.velocity);
  if (speed < 0.1F) {
    p.velocity.x = 0.0F;
    p.velocity.z = 0.0F;
    return;
  }
  const float control = speed < kStopSpeed ? kStopSpeed : speed;
  float new_speed = speed - control * kFriction * kTickSeconds;
  if (new_speed < 0.0F) {
    new_speed = 0.0F;
  }
  const float factor = new_speed / speed;
  p.velocity.x *= factor;
  p.velocity.z *= factor;
}

void accelerate(PlayerState& p, Vec3 wish_dir, float wish_speed) {
  const float current = dot(p.velocity, wish_dir);
  const float add_speed = wish_speed - current;
  if (add_speed <= 0.0F) {
    return;
  }
  float accel_speed = kGroundAccelerate * kTickSeconds * wish_speed;
  if (accel_speed > add_speed) {
    accel_speed = add_speed;
  }
  p.velocity = add(p.velocity, scale(wish_dir, accel_speed));
}

void air_accelerate(PlayerState& p, Vec3 wish_dir, float wish_speed) {
  const float capped = wish_speed > kAirWishSpeedCap ? kAirWishSpeedCap : wish_speed;
  const float current = dot(p.velocity, wish_dir);
  const float add_speed = capped - current;
  if (add_speed <= 0.0F) {
    return;
  }
  // GoldSrc quirk: accel uses the uncapped wishspeed. This is what makes
  // air strafing gain speed.
  float accel_speed = kAirAccelerate * wish_speed * kTickSeconds;
  if (accel_speed > add_speed) {
    accel_speed = add_speed;
  }
  p.velocity = add(p.velocity, scale(wish_dir, accel_speed));
}

void clamp_velocity(PlayerState& p) {
  float* v = &p.velocity.x;
  for (int i = 0; i < 3; ++i) {
    if (v[i] > kMaxVelocityPerAxis) {
      v[i] = kMaxVelocityPerAxis;
    } else if (v[i] < -kMaxVelocityPerAxis) {
      v[i] = -kMaxVelocityPerAxis;
    }
  }
}

// PM_FlyMove/Q3 PM_SlideMove hybrid: move the hull, sliding along contact
// planes. Overclip pushes velocity slightly off each plane, which on a sealed
// brush world is enough to guarantee the next trace starts outside it and
// cannot re-hit the same plane at fraction 0.
void slide_move(PlayerState& p, float dt) {
  constexpr float kOverclip = 1.001F;
  Vec3 planes[kMaxClipPlanes];
  int num_planes = 0;
  const Vec3 primal_velocity = p.velocity;
  Vec3 original_velocity = p.velocity;
  float time_left = dt;
  const Vec3 half = hull_half(p);
  const Vec3 start_origin = p.origin;

  for (int bump = 0; bump < kMaxBumps; ++bump) {
    if (p.velocity.x == 0.0F && p.velocity.y == 0.0F && p.velocity.z == 0.0F) {
      break;
    }
    const Vec3 end = add(p.origin, scale(p.velocity, time_left));
    const TraceResult trace = world_trace_hull(p.origin, end, half);

    if (trace.fraction > 0.0F) {
      p.origin = trace.end;
      original_velocity = p.velocity;
      num_planes = 0;
    }
    if (!trace.hit) {
      break; // moved the full distance
    }
    time_left -= time_left * trace.fraction;

    if (num_planes >= kMaxClipPlanes) {
      p.velocity = {0.0F, 0.0F, 0.0F};
      break;
    }
    planes[num_planes] = trace.normal;
    ++num_planes;

    // Clip velocity against all gathered planes; handle creases by sliding
    // along the seam.
    int i = 0;
    for (; i < num_planes; ++i) {
      p.velocity = clip_velocity(original_velocity, planes[i], kOverclip);
      int j = 0;
      for (; j < num_planes; ++j) {
        if (j != i && dot(p.velocity, planes[j]) < 0.0F) {
          break;
        }
      }
      if (j == num_planes) {
        break;
      }
    }
    if (i == num_planes) {
      if (num_planes != 2) {
        p.velocity = {0.0F, 0.0F, 0.0F};
        break;
      }
      const Vec3 dir = {planes[0].y * planes[1].z - planes[0].z * planes[1].y,
                        planes[0].z * planes[1].x - planes[0].x * planes[1].z,
                        planes[0].x * planes[1].y - planes[0].y * planes[1].x};
      p.velocity = scale(dir, dot(dir, p.velocity));
    }
    if (dot(p.velocity, primal_velocity) <= 0.0F) {
      p.velocity = {0.0F, 0.0F, 0.0F};
      break;
    }
  }

  // Wedged in a crevice: no movement at all but we wanted some. Pull off along
  // the contact normals so next tick can recover (bounded, overlap-checked).
  if (num_planes > 0 && p.origin.x == start_origin.x &&
      p.origin.y == start_origin.y && p.origin.z == start_origin.z) {
    Vec3 push = {0.0F, 0.0F, 0.0F};
    for (int k = 0; k < num_planes; ++k) {
      push = add(push, planes[k]);
    }
    const Vec3 candidate = add(p.origin, scale(push, 0.125F));
    if (!world_overlap_hull(candidate, half)) {
      p.origin = candidate;
    }
  }
}

// PM_WalkMove's step logic: run the slide twice (direct, and stepped up),
// keep whichever travelled farther horizontally.
void step_slide_move(PlayerState& p, float dt) {
  const Vec3 start_origin = p.origin;
  const Vec3 start_velocity = p.velocity;
  const Vec3 half = hull_half(p);

  slide_move(p, dt);
  const Vec3 down_origin = p.origin;
  const Vec3 down_velocity = p.velocity;

  // Retry from a stepped-up position.
  p.origin = start_origin;
  p.velocity = start_velocity;
  const Vec3 up = {0.0F, kStepHeight, 0.0F};
  TraceResult trace = world_trace_hull(p.origin, add(p.origin, up), half);
  p.origin = trace.end;
  slide_move(p, dt);
  trace = world_trace_hull(p.origin, sub(p.origin, up), half);
  if (trace.hit && trace.normal.y < kGroundNormalMinY) {
    // Stepped onto a steep face; the direct route wins.
    p.origin = down_origin;
    p.velocity = down_velocity;
    return;
  }
  p.origin = trace.end;

  const Vec3 down_delta = sub(down_origin, start_origin);
  const Vec3 up_delta = sub(p.origin, start_origin);
  const float down_dist = down_delta.x * down_delta.x + down_delta.z * down_delta.z;
  const float up_dist = up_delta.x * up_delta.x + up_delta.z * up_delta.z;
  if (down_dist >= up_dist) {
    p.origin = down_origin;
    p.velocity = down_velocity;
  } else {
    p.velocity.y = down_velocity.y;
  }
}

// If the hull ended up embedded in geometry (stance transitions near edges,
// residual overlap after landing on lips), nudge it out. Trying the duck hull
// as a last resort mirrors GoldSrc's hull-switch unstick.
void unstick(PlayerState& p) {
  const Vec3 half = hull_half(p);
  if (!world_overlap_hull(p.origin, half)) {
    return;
  }
  constexpr Vec3 kNudges[] = {
      {0.0F, 1.0F, 0.0F},  {0.0F, 4.0F, 0.0F},  {0.0F, 9.0F, 0.0F},
      {0.0F, 18.0F, 0.0F}, {2.0F, 0.0F, 0.0F},  {-2.0F, 0.0F, 0.0F},
      {0.0F, 0.0F, 2.0F},  {0.0F, 0.0F, -2.0F}, {0.0F, -2.0F, 0.0F},
  };
  for (const Vec3& nudge : kNudges) {
    const Vec3 candidate = add(p.origin, nudge);
    if (!world_overlap_hull(candidate, half)) {
      p.origin = candidate;
      return;
    }
  }
  if (!p.ducked) {
    const Vec3 duck_half = {kHullHalfWidth, kHullHalfHeightDuck, kHullHalfWidth};
    if (!world_overlap_hull(p.origin, duck_half)) {
      p.ducked = true;
    }
  }
}

void categorize_position(PlayerState& p) {
  const bool was_on_ground = p.on_ground;
  if (p.velocity.y > kJumpingAwaySpeed) {
    p.on_ground = false;
    return;
  }
  const Vec3 down = {p.origin.x, p.origin.y - kGroundCheckDistance, p.origin.z};
  const TraceResult trace = world_trace_hull(p.origin, down, hull_half(p));
  if (trace.hit && trace.normal.y >= kGroundNormalMinY) {
    p.on_ground = true;
    // Whatever is under the feet is what the next footstep sounds like.
    p.ground_material = trace.material;
    p.origin = trace.end; // stay planted walking down slopes/steps
    if (!was_on_ground) {
      // Landing fatigue: remaining stamina bleeds horizontal speed.
      if (p.stamina > 0.0F) {
        const float ratio = stamina_ratio(p.stamina);
        p.velocity.x *= ratio;
        p.velocity.z *= ratio;
      }
      if (p.velocity.y < 0.0F) {
        p.velocity.y = 0.0F;
      }
    }
  } else {
    p.on_ground = false;
  }
}

/**
 * Footfalls, by distance travelled rather than by a timer — a ducked player
 * covers ground slowly and so steps rarely, which falls out for free.
 *
 * Holding +speed is silent. That is the whole reason the key exists: in 1.6 the
 * trade is mobility for not announcing yourself, and it is only a real trade if
 * the sim is the thing that decides you made no sound.
 */
void update_footsteps(PlayerState& p, Vec3 moved_from, bool walking) {
  if (!p.on_ground) {
    return;
  }
  const float dx = p.origin.x - moved_from.x;
  const float dz = p.origin.z - moved_from.z;
  p.step_distance += std::sqrt(dx * dx + dz * dz);
  if (p.step_distance < kStrideDistance) {
    return;
  }
  p.step_distance = 0.0F;
  if (!walking && horizontal_speed(p.velocity) >= kStepMinSpeed) {
    p.stepped = true;
  }
}

void update_duck(PlayerState& p, bool wants_duck) {
  if (wants_duck && !p.ducked) {
    p.ducked = true;
    if (p.on_ground) {
      // Feet stay planted: hull shrinks downward.
      p.origin.y -= kHullHalfHeightStand - kHullHalfHeightDuck;
    }
  } else if (!wants_duck && p.ducked) {
    // Unduck only if the standing hull actually fits; a swept trace can't see
    // geometry it already starts inside, so use a real overlap test.
    Vec3 stand_origin = p.origin;
    if (p.on_ground) {
      stand_origin.y += kHullHalfHeightStand - kHullHalfHeightDuck;
    }
    const Vec3 stand_half = {kHullHalfWidth, kHullHalfHeightStand, kHullHalfWidth};
    if (!world_overlap_hull(stand_origin, stand_half)) {
      p.ducked = false;
      p.origin = stand_origin;
    }
  }
  // Smooth the eye height toward the current stance.
  const float target = p.ducked ? kEyeAboveCenterDuck : kEyeAboveCenterStand;
  const float rate =
      (kEyeAboveCenterStand - kEyeAboveCenterDuck) / kDuckLerpSeconds * kTickSeconds;
  if (p.view_offset < target) {
    p.view_offset = p.view_offset + rate > target ? target : p.view_offset + rate;
  } else if (p.view_offset > target) {
    p.view_offset = p.view_offset - rate < target ? target : p.view_offset - rate;
  }
}

/**
 * A jump tap arms a buffer that survives kJumpBufferTicks. The jump fires on
 * the first grounded tick while the buffer is live, so pressing slightly early
 * — which is what a human bhop actually does — still hops. Holding the button
 * never re-arms it: the buffer is set on the press edge only, so chaining hops
 * still costs one tap each and the 1.6 rhythm survives.
 */
void try_jump(PlayerState& p, bool jump_pressed, float base_max_speed) {
  if (!jump_pressed) {
    p.jump_held = false;
  } else if (!p.jump_held) {
    p.jump_held = true;
    p.jump_buffer_ticks = kJumpBufferTicks;
  }
  if (p.jump_buffer_ticks == 0U || !p.on_ground) {
    return;
  }
  p.jump_buffer_ticks = 0U;
  p.on_ground = false;

  // PM_PreventMegaBunnyJumping: cap chained-hop speed hard.
  const float max_scaled =
      kBhopSpeedFactor * current_max_speed(p, base_max_speed, false);
  const float speed = length(p.velocity);
  if (max_scaled > 0.0F && speed > max_scaled) {
    const float fraction = (max_scaled / speed) * kBhopSlowdown;
    p.velocity = scale(p.velocity, fraction);
  }

  float impulse = kJumpImpulse;
  if (p.stamina > 0.0F) {
    impulse *= stamina_ratio(p.stamina);
  }
  p.velocity.y = impulse;
  p.stamina = kStaminaFull;
}

} // namespace

void pmove_run(PlayerState& p, const InputCommand& cmd, float base_max_speed) {
  p.stepped = false;
  p.land_speed = 0.0F;
  // Impact speed has to be sampled before anything touches velocity: the slide
  // clips the downward component against the floor plane, so by the time we
  // know we are standing on something, the speed we hit it at is gone.
  const bool was_airborne = !p.on_ground;
  const float fall_speed = -p.velocity.y;

  p.yaw = cmd.yaw;
  float pitch = cmd.pitch;
  const float pitch_limit = 89.0F * 3.14159265F / 180.0F;
  if (pitch > pitch_limit) {
    pitch = pitch_limit;
  } else if (pitch < -pitch_limit) {
    pitch = -pitch_limit;
  }
  p.pitch = pitch;

  if (p.stamina > 0.0F) {
    p.stamina -= kStaminaDrainPerSecond * kTickSeconds;
    if (p.stamina < 0.0F) {
      p.stamina = 0.0F;
    }
  }
  if (p.jump_buffer_ticks > 0U) {
    --p.jump_buffer_ticks;
  }

  unstick(p);
  categorize_position(p);
  update_duck(p, (cmd.buttons & ButtonDuck) != 0U);
  try_jump(p, (cmd.buttons & ButtonJump) != 0U, base_max_speed);

  // Wish direction from yaw only; -Z is forward at yaw 0.
  const float sin_yaw = std::sin(p.yaw);
  const float cos_yaw = std::cos(p.yaw);
  const Vec3 forward = {-sin_yaw, 0.0F, -cos_yaw};
  const Vec3 right = {cos_yaw, 0.0F, -sin_yaw};
  Vec3 wish_vel =
      add(scale(forward, cmd.forward), scale(right, cmd.strafe));
  wish_vel.y = 0.0F;
  const float max_speed =
      current_max_speed(p, base_max_speed, (cmd.buttons & ButtonWalk) != 0U);
  wish_vel = scale(wish_vel, max_speed);
  float wish_speed = length(wish_vel);
  Vec3 wish_dir = {0.0F, 0.0F, 0.0F};
  if (wish_speed > 0.0F) {
    wish_dir = scale(wish_vel, 1.0F / wish_speed);
  }
  if (wish_speed > max_speed) {
    wish_speed = max_speed;
  }

  const Vec3 pre_move = p.origin;
  if (p.on_ground) {
    p.velocity.y = 0.0F;
    apply_friction(p);
    accelerate(p, wish_dir, wish_speed);
    p.velocity.y = 0.0F;
    clamp_velocity(p);
    step_slide_move(p, kTickSeconds);
  } else {
    // Split gravity around the move for tick-rate independence.
    p.velocity.y -= kGravity * kTickSeconds * 0.5F;
    air_accelerate(p, wish_dir, wish_speed);
    clamp_velocity(p);
    slide_move(p, kTickSeconds);
    p.velocity.y -= kGravity * kTickSeconds * 0.5F;
  }

  categorize_position(p);
  if (was_airborne && p.on_ground) {
    // A hair above zero so a touchdown at rest still registers as one.
    p.land_speed = fall_speed > 1.0F ? fall_speed : 1.0F;
    p.step_distance = 0.0F; // the landing *is* this stride's footfall
  }
  update_footsteps(p, pre_move, (cmd.buttons & ButtonWalk) != 0U);
}

} // namespace cs
