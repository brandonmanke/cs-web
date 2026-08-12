#include "state.h"
#include "world.h"

#include <cmath>

// Bots. Not a second movement system: a bot decides what buttons it would have
// pressed and hands back an InputCommand, which the caller runs through the
// same pmove and weapons code the local player uses. If a bot can do something
// you cannot, that is a bug in this file, not a different rulebook.
//
// Navigation is deliberately reactive rather than a nav mesh: goals come from
// the map's spawn points, steering is direct, and everything else falls out of
// bump-and-slide plus a ledge probe. In arenas this size that reads as roaming;
// a real graph is the M-net-era problem, not this one.

namespace cs {
namespace {

constexpr float kPi = 3.14159265F;

struct SkillDef {
  float turn_rate;    // radians/second the aim can slew
  float aim_error;    // radians of standing error, re-rolled periodically
  std::uint32_t reaction_ticks; // delay before firing on a fresh target
  std::uint32_t burst_ticks;    // trigger held per burst
  std::uint32_t rest_ticks;     // trigger released between bursts
  float fire_cone;    // radians of aim error tolerated before firing
};

// Anchors, not presets: skill is a float and everything between two rows is
// interpolated, so the menu's slider is a real dial rather than three buttons
// wearing a slider's clothes.
constexpr SkillDef kSkills[3] = {
    {2.6F, 0.150F, 52U, 4U, 56U, 0.130F},  // easy
    {6.5F, 0.055F, 26U, 9U, 26U, 0.070F},  // normal
    {13.0F, 0.015F, 8U, 16U, 10U, 0.040F}, // hard
};

// Bots re-scan for a target on this cadence, staggered by player index so the
// whole roster never traces on the same tick.
constexpr std::uint32_t kScanInterval = 8U;
constexpr float kSightRange = 3000.0F;
constexpr float kPreferredRange = 340.0F;
constexpr float kRangeSlack = 130.0F;
constexpr std::uint32_t kStuckLimit = 14U;
constexpr float kGoalReached = 110.0F;

std::uint32_t lerp_ticks(std::uint32_t a, std::uint32_t b, float t) {
  const float value = static_cast<float>(a) +
                      (static_cast<float>(b) - static_cast<float>(a)) * t;
  return static_cast<std::uint32_t>(value + 0.5F);
}

/** The skill row for a bot, blended between the two anchors it sits between. */
SkillDef skill_of(const PlayerEntity& e) {
  float skill = e.bot.skill;
  if (!(skill > 0.0F)) { // also catches NaN
    skill = 0.0F;
  } else if (skill > 2.0F) {
    skill = 2.0F;
  }
  const std::uint32_t low = skill >= 1.0F ? 1U : 0U;
  const float t = skill - static_cast<float>(low);
  const SkillDef& a = kSkills[low];
  const SkillDef& b = kSkills[low + 1U];
  return {
      a.turn_rate + (b.turn_rate - a.turn_rate) * t,
      a.aim_error + (b.aim_error - a.aim_error) * t,
      lerp_ticks(a.reaction_ticks, b.reaction_ticks, t),
      lerp_ticks(a.burst_ticks, b.burst_ticks, t),
      lerp_ticks(a.rest_ticks, b.rest_ticks, t),
      a.fire_cone + (b.fire_cone - a.fire_cone) * t,
  };
}

float wrap_angle(float a) {
  while (a > kPi) a -= 2.0F * kPi;
  while (a < -kPi) a += 2.0F * kPi;
  return a;
}

/** Yaw that faces the world direction (dx, dz). Yaw 0 looks down -Z. */
float yaw_toward(float dx, float dz) { return std::atan2(-dx, -dz); }

float turn_toward(float current, float desired, float max_delta) {
  const float delta = wrap_angle(desired - current);
  if (delta > max_delta) return wrap_angle(current + max_delta);
  if (delta < -max_delta) return wrap_angle(current - max_delta);
  return wrap_angle(desired);
}

/** Chest height on a standing player — where a bot aims and what LOS tests. */
Vec3 aim_point(const PlayerEntity& e) {
  const Vec3 feet = feet_of(e);
  return {feet.x, feet.y + (e.move.ducked ? 24.0F : 48.0F), feet.z};
}

bool has_los(const PlayerEntity& from, const PlayerEntity& to) {
  return !world_trace_ray(eye_of(from), aim_point(to)).hit;
}

/**
 * Is there floor a step ahead? Bots that walk off the foundry's pit lip every
 * lap read as broken, and this is two rays cheaper than knowing the map.
 */
bool footing_ahead(const PlayerEntity& e, float dx, float dz) {
  const Vec3 feet = feet_of(e);
  const Vec3 start = {feet.x + dx * 34.0F, feet.y + 10.0F, feet.z + dz * 34.0F};
  const Vec3 end = {start.x, feet.y - 100.0F, start.z};
  return world_trace_ray(start, end).hit;
}

void pick_goal(SimState& s, std::uint32_t index) {
  BotState& bot = s.players[index].bot;
  bot.goal_ticks = 320U + rand_below(s, 256U);
  if (s.spawn_count == 0U) {
    bot.goal = s.players[index].move.origin;
    return;
  }
  bot.goal = s.spawns[rand_below(s, s.spawn_count)].origin;
}

/** Nearest enemy this bot can actually see, or kMaxPlayers. */
std::uint32_t scan_for_target(SimState& s, std::uint32_t index) {
  const PlayerEntity& self = s.players[index];
  std::uint32_t best = kMaxPlayers;
  float best_dist = kSightRange;
  for (std::uint32_t i = 0; i < s.player_count; ++i) {
    if (!is_enemy(s, index, i)) {
      continue;
    }
    const PlayerEntity& other = s.players[i];
    const float dx = other.move.origin.x - self.move.origin.x;
    const float dy = other.move.origin.y - self.move.origin.y;
    const float dz = other.move.origin.z - self.move.origin.z;
    const float dist = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= best_dist || !has_los(self, other)) {
      continue;
    }
    best_dist = dist;
    best = i;
  }
  return best;
}

} // namespace

void bot_reset(SimState& s, std::uint32_t index, float skill) {
  BotState& bot = s.players[index].bot;
  bot = {};
  bot.skill = skill;
  bot.target = kMaxPlayers;
  bot.strafe_dir = rand_float(s) < 0.5F ? -1.0F : 1.0F;
  bot.scan_ticks = index % kScanInterval;
  pick_goal(s, index);
}

InputCommand bot_think(SimState& s, std::uint32_t index) {
  PlayerEntity& e = s.players[index];
  BotState& bot = e.bot;
  const SkillDef skill = skill_of(e);

  InputCommand cmd = {};
  cmd.yaw = e.move.yaw;
  cmd.pitch = e.move.pitch;

  // --- target selection ----------------------------------------------------
  if (bot.scan_ticks > 0U) {
    --bot.scan_ticks;
  }
  // Skill 0 is passive: the bot roams and never pulls a trigger, so any map can
  // be a map with company in it rather than an empty one or a firefight. It is
  // not an interpolation anchor — it is the absence of engagement, which is why
  // it reads the raw skill rather than the blended row. NaN and negatives land
  // here too, which is the safe way for them to land.
  const bool engages = s.mode != ModeRange && e.bot.skill > 0.0F;
  if (!engages) {
    bot.target = kMaxPlayers;
  } else if (bot.scan_ticks == 0U) {
    bot.scan_ticks = kScanInterval;
    const std::uint32_t previous = bot.target;
    const bool keep = previous < s.player_count && is_enemy(s, index, previous) &&
                      has_los(e, s.players[previous]);
    if (!keep) {
      if (previous < kMaxPlayers) {
        // Chase where they were last seen instead of forgetting them.
        bot.goal = s.players[previous].move.origin;
        bot.goal_ticks = 220U;
      }
      bot.target = scan_for_target(s, index);
      if (bot.target < kMaxPlayers) {
        bot.reaction_ticks = skill.reaction_ticks;
      }
    }
  }

  // --- aim -----------------------------------------------------------------
  if (bot.error_ticks > 0U) {
    --bot.error_ticks;
  } else {
    bot.error_ticks = 20U + rand_below(s, 24U);
    bot.aim_yaw_error = (rand_float(s) * 2.0F - 1.0F) * skill.aim_error;
    bot.aim_pitch_error = (rand_float(s) * 2.0F - 1.0F) * skill.aim_error;
  }

  const float max_turn = skill.turn_rate * kTickSeconds;
  float aim_offset = kPi; // how far off target the aim still is
  float target_dist = 0.0F;
  float roam_dist = 0.0F; // distance left to the roam goal, 0 while engaging
  const bool has_target = bot.target < s.player_count &&
                          is_enemy(s, index, bot.target);
  if (has_target) {
    const PlayerEntity& victim = s.players[bot.target];
    const Vec3 eye = eye_of(e);
    const Vec3 at = aim_point(victim);
    const float dx = at.x - eye.x;
    const float dy = at.y - eye.y;
    const float dz = at.z - eye.z;
    target_dist = std::sqrt(dx * dx + dy * dy + dz * dz);

    const float want_yaw = wrap_angle(yaw_toward(dx, dz) + bot.aim_yaw_error);
    const float want_pitch =
        (target_dist > 1e-3F ? std::asin(dy / target_dist) : 0.0F) + bot.aim_pitch_error;
    cmd.yaw = turn_toward(e.move.yaw, want_yaw, max_turn);
    cmd.pitch = turn_toward(e.move.pitch, want_pitch, max_turn);
    aim_offset = std::fabs(wrap_angle(want_yaw - cmd.yaw)) +
                 std::fabs(want_pitch - cmd.pitch);
    roam_dist = 0.0F;
  } else {
    if (bot.goal_ticks > 0U) {
      --bot.goal_ticks;
    } else {
      pick_goal(s, index);
    }
    float dx = bot.goal.x - e.move.origin.x;
    float dz = bot.goal.z - e.move.origin.z;
    if (dx * dx + dz * dz < kGoalReached * kGoalReached) {
      pick_goal(s, index);
      dx = bot.goal.x - e.move.origin.x;
      dz = bot.goal.z - e.move.origin.z;
    }
    roam_dist = std::sqrt(dx * dx + dz * dz);
    if (roam_dist > 1.0F) {
      cmd.yaw = turn_toward(e.move.yaw, yaw_toward(dx, dz), max_turn);
    }
    cmd.pitch = turn_toward(e.move.pitch, 0.0F, max_turn);
  }

  // --- movement ------------------------------------------------------------
  // Desired world-space direction, then projected onto the bot's own facing so
  // it comes out as the forward/strafe a human would be holding.
  float want_x = 0.0F;
  float want_z = 0.0F;
  const float sin_yaw = std::sin(cmd.yaw);
  const float cos_yaw = std::cos(cmd.yaw);
  const float fwd_x = -sin_yaw;
  const float fwd_z = -cos_yaw;
  const float right_x = cos_yaw;
  const float right_z = -sin_yaw;

  if (has_target) {
    // Hold a working distance and keep moving sideways; a bot that stands still
    // in the open is target practice, and one that walks straight at you is
    // worse.
    if (target_dist > kPreferredRange + kRangeSlack) {
      want_x += fwd_x;
      want_z += fwd_z;
    } else if (target_dist < kPreferredRange - kRangeSlack) {
      want_x -= fwd_x;
      want_z -= fwd_z;
    }
    if (bot.strafe_ticks == 0U) {
      bot.strafe_ticks = 32U + rand_below(s, 48U);
      bot.strafe_dir = -bot.strafe_dir;
    }
    --bot.strafe_ticks;
    want_x += right_x * bot.strafe_dir * 0.9F;
    want_z += right_z * bot.strafe_dir * 0.9F;
  } else if (roam_dist > 1.0F) {
    want_x = fwd_x;
    want_z = fwd_z;
  }
  // Nowhere to be (a map with no spawn points, or already standing on the
  // goal): hold position rather than march off in whatever direction yaw 0 is.

  const float want_len = std::sqrt(want_x * want_x + want_z * want_z);
  if (want_len > 1e-4F) {
    want_x /= want_len;
    want_z /= want_len;
  }

  // Ledge and wall handling. Both present as "the way I want to go is not
  // walkable", and both are answered by peeling off along the current strafe
  // direction until something changes.
  const bool blocked_ahead = want_len > 1e-4F && !footing_ahead(e, want_x, want_z);
  const float speed_h = std::sqrt(e.move.velocity.x * e.move.velocity.x +
                                  e.move.velocity.z * e.move.velocity.z);
  if (want_len > 1e-4F && speed_h < 24.0F && e.move.on_ground) {
    ++bot.stuck_ticks;
  } else if (bot.stuck_ticks > 0U) {
    --bot.stuck_ticks;
  }
  const bool stuck = bot.stuck_ticks >= kStuckLimit;
  if (blocked_ahead || stuck) {
    want_x = right_x * bot.strafe_dir;
    want_z = right_z * bot.strafe_dir;
    if (stuck) {
      cmd.buttons |= ButtonJump; // the obstacle may just be a crate
      if (bot.stuck_ticks > kStuckLimit * 3U) {
        bot.stuck_ticks = 0U;
        bot.strafe_dir = -bot.strafe_dir;
        if (!has_target) pick_goal(s, index);
      }
    }
  }

  cmd.forward = want_x * fwd_x + want_z * fwd_z;
  cmd.strafe = want_x * right_x + want_z * right_z;

  // --- trigger -------------------------------------------------------------
  const WeaponDef& def = weapon_def(e.weapon.selected);
  if (def.magazine > 0U && e.weapon.magazine[e.weapon.selected] == 0U) {
    cmd.buttons |= ButtonReload;
  } else if (has_target && engages) {
    if (bot.reaction_ticks > 0U) {
      --bot.reaction_ticks;
    } else if (aim_offset <= skill.fire_cone) {
      if (bot.rest_ticks > 0U) {
        --bot.rest_ticks;
      } else {
        if (bot.burst_ticks == 0U) {
          bot.burst_ticks = def.automatic ? skill.burst_ticks : 1U;
        }
        cmd.buttons |= ButtonFire;
        --bot.burst_ticks;
        if (bot.burst_ticks == 0U) {
          bot.rest_ticks = skill.rest_ticks;
        }
      }
    }
  } else {
    bot.burst_ticks = 0U;
    bot.rest_ticks = 0U;
  }

  return cmd;
}

} // namespace cs
