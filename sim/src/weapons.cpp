#include "state.h"
#include "world.h"

#include <cmath>

// Hitscan gunplay: deterministic spray pattern + movement inaccuracy + view
// punch. Bullets ray-trace the box3d world and manual AABB hitboxes on targets.

namespace cs {
namespace {

constexpr WeaponDef kWeapons[kWeaponCount] = {
    // id, name, mag, reserve, dmg, rangeMod, spread, patternScale, punch, maxSpeed,
    // fireTicks, reloadTicks, recoveryTicks, automatic
    {WeaponNone, "None", 0, 0, 0.0F, 1.0F, 0.0F, 0.0F, 0.0F, kMaxSpeed, 1, 1, 1, false},
    {WeaponKnife, "Knife", 0, 0, 55.0F, 1.0F, 0.0F, 0.0F, 0.001F, 250.0F, 25, 1, 1, true},
    {WeaponUsp, "USP", 12, 100, 34.0F, 0.79F, 0.0045F, 0.72F, 0.014F, 250.0F, 10, 140, 22, false},
    {WeaponGlock, "Glock", 20, 120, 25.0F, 0.75F, 0.0060F, 0.62F, 0.011F, 250.0F, 9, 145, 20, false},
    {WeaponAk47, "AK-47", 30, 90, 36.0F, 0.80F, 0.0070F, 1.00F, 0.020F, 221.0F, 6, 160, 16, true},
    {WeaponM4a1, "M4A1", 30, 90, 33.0F, 0.82F, 0.0055F, 0.82F, 0.016F, 230.0F, 6, 165, 16, true},
    {WeaponAwp, "AWP", 10, 30, 115.0F, 0.99F, 0.0015F, 1.18F, 0.040F, 210.0F, 95, 235, 60, false},
    {WeaponMp5, "MP5", 30, 120, 26.0F, 0.84F, 0.0090F, 0.44F, 0.009F, 250.0F, 5, 150, 14, true},
};

// Rifle spray: climbs for ~9 shots then swings left, then right. Offsets are
// radians (yaw, pitch-up) at pattern_scale 1.
struct PatternOffset {
  float x;
  float y;
};
constexpr PatternOffset kRiflePattern[30] = {
    {0.000F, 0.000F},  {0.001F, 0.010F},  {0.003F, 0.021F},  {0.005F, 0.033F},
    {0.008F, 0.045F},  {0.010F, 0.057F},  {0.012F, 0.068F},  {0.010F, 0.078F},
    {0.006F, 0.086F},  {0.000F, 0.092F},  {-0.008F, 0.097F}, {-0.017F, 0.101F},
    {-0.027F, 0.104F}, {-0.037F, 0.106F}, {-0.045F, 0.107F}, {-0.050F, 0.107F},
    {-0.048F, 0.106F}, {-0.041F, 0.104F}, {-0.031F, 0.101F}, {-0.018F, 0.098F},
    {-0.004F, 0.095F}, {0.010F, 0.093F},  {0.024F, 0.091F},  {0.036F, 0.090F},
    {0.045F, 0.090F},  {0.048F, 0.091F},  {0.044F, 0.093F},  {0.035F, 0.096F},
    {0.022F, 0.100F},  {0.008F, 0.104F},
};

struct Hitbox {
  Vec3 mins; // relative to target feet
  Vec3 maxs;
  HitGroup group;
};
constexpr Hitbox kHitboxes[4] = {
    {{-6.0F, 58.0F, -6.0F}, {6.0F, 72.0F, 6.0F}, HitHead},
    {{-12.0F, 38.0F, -7.0F}, {12.0F, 58.0F, 7.0F}, HitChest},
    {{-11.0F, 26.0F, -7.0F}, {11.0F, 38.0F, 7.0F}, HitStomach},
    {{-14.0F, 0.0F, -6.0F}, {14.0F, 26.0F, 6.0F}, HitLimbs},
};

constexpr float kTargetHealth = 100.0F;
constexpr std::uint32_t kTargetRespawnTicks = 96; // 1.5 s
constexpr std::uint32_t kTargetFlashTicks = 8;
constexpr float kPunchDecayPerTick = 0.82F;

float hit_group_multiplier(HitGroup group) {
  switch (group) {
    case HitHead: return 4.0F;
    case HitStomach: return 1.25F;
    case HitLimbs: return 0.75F;
    default: return 1.0F;
  }
}

// Slab test; returns entry distance along dir or a negative value on miss.
float ray_aabb(Vec3 origin, Vec3 dir, Vec3 mins, Vec3 maxs, float max_dist) {
  float t_min = 0.0F;
  float t_max = max_dist;
  const float* o = &origin.x;
  const float* d = &dir.x;
  const float* lo = &mins.x;
  const float* hi = &maxs.x;
  for (int i = 0; i < 3; ++i) {
    if (d[i] > -1e-8F && d[i] < 1e-8F) {
      if (o[i] < lo[i] || o[i] > hi[i]) {
        return -1.0F;
      }
      continue;
    }
    const float inv = 1.0F / d[i];
    float t0 = (lo[i] - o[i]) * inv;
    float t1 = (hi[i] - o[i]) * inv;
    if (t0 > t1) {
      const float tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > t_min) {
      t_min = t0;
    }
    if (t1 < t_max) {
      t_max = t1;
    }
    if (t_min > t_max) {
      return -1.0F;
    }
  }
  return t_min;
}

void start_reload(SimState& s) {
  WeaponState& w = s.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  if (def.magazine == 0 || w.reload_ticks > 0 || w.magazine[w.selected] >= def.magazine ||
      w.reserve[w.selected] == 0) {
    return;
  }
  w.reload_ticks = def.reload_ticks;
}

void finish_reload(SimState& s) {
  WeaponState& w = s.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  const std::uint32_t want = def.magazine - w.magazine[w.selected];
  const std::uint32_t take = want < w.reserve[w.selected] ? want : w.reserve[w.selected];
  w.magazine[w.selected] += take;
  w.reserve[w.selected] -= take;
}

void fire_shot(SimState& s) {
  WeaponState& w = s.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  const PlayerState& p = s.player;

  ++w.shot_sequence;
  ++s.shots;
  ShotEvent event = {};
  event.sequence = w.shot_sequence;

  const Vec3 eye = {p.origin.x, p.origin.y + p.view_offset, p.origin.z};
  event.start = eye;

  // Spray pattern (rifles walk the whole table; others reuse the early ramp).
  const std::uint32_t pattern_index =
      w.shot_index < 29U ? w.shot_index : 29U;
  const PatternOffset pattern = kRiflePattern[pattern_index];

  // Inaccuracy grows with movement and goes wild airborne.
  const float speed_h = std::sqrt(p.velocity.x * p.velocity.x + p.velocity.z * p.velocity.z);
  float inaccuracy = def.spread;
  inaccuracy *= 1.0F + (speed_h / kMaxSpeed) * 2.5F + (p.on_ground ? 0.0F : 5.0F);
  if (p.ducked && p.on_ground) {
    inaccuracy *= 0.7F;
  }
  const float jitter_x = (rand_float(s) * 2.0F - 1.0F) * inaccuracy;
  const float jitter_y = (rand_float(s) * 2.0F - 1.0F) * inaccuracy;

  // Pattern climbs: impacts walk up the wall as the spray continues.
  const float shot_yaw = p.yaw + pattern.x * def.pattern_scale + jitter_x;
  const float shot_pitch = p.pitch + pattern.y * def.pattern_scale + jitter_y;

  const float cp = std::cos(shot_pitch);
  const Vec3 dir = {-std::sin(shot_yaw) * cp, std::sin(shot_pitch),
                    -std::cos(shot_yaw) * cp};

  // World hit distance bounds the target search.
  const Vec3 far_end = {eye.x + dir.x * kShotRange, eye.y + dir.y * kShotRange,
                        eye.z + dir.z * kShotRange};
  const TraceResult world_trace = world_trace_ray(eye, far_end);
  const float world_dist = world_trace.hit ? world_trace.fraction * kShotRange : kShotRange;

  float best_dist = world_dist;
  int best_target = -1;
  HitGroup best_group = HitNone;
  for (std::uint32_t t = 0; t < s.target_count; ++t) {
    TargetState& target = s.targets[t];
    if (!target.alive) {
      continue;
    }
    for (const Hitbox& box : kHitboxes) {
      const Vec3 mins = {target.origin.x + box.mins.x, target.origin.y + box.mins.y,
                         target.origin.z + box.mins.z};
      const Vec3 maxs = {target.origin.x + box.maxs.x, target.origin.y + box.maxs.y,
                         target.origin.z + box.maxs.z};
      const float dist = ray_aabb(eye, dir, mins, maxs, best_dist);
      if (dist >= 0.0F && dist < best_dist) {
        best_dist = dist;
        best_target = static_cast<int>(t);
        best_group = box.group;
      }
    }
  }

  event.end = {eye.x + dir.x * best_dist, eye.y + dir.y * best_dist,
               eye.z + dir.z * best_dist};

  if (best_target >= 0) {
    TargetState& target = s.targets[best_target];
    float damage = def.base_damage * std::pow(def.range_modifier, best_dist / 500.0F);
    damage *= hit_group_multiplier(best_group);
    target.health -= damage;
    target.flash_ticks = kTargetFlashTicks;
    event.hit_group = best_group;
    event.target_index = static_cast<std::uint32_t>(best_target);
    event.damage = damage;
    ++s.hits;
    if (target.health <= 0.0F) {
      target.alive = false;
      target.respawn_ticks = kTargetRespawnTicks;
      ++s.kills;
      event.result = ShotKill;
    } else {
      event.result = ShotHit;
    }
  } else if (world_trace.hit) {
    event.result = ShotWorld;
    event.material = world_trace.material;
  } else {
    event.result = ShotMiss;
  }

  s.last_shot = event;
  w.punch_pitch += def.punch_per_shot;
  w.punch_yaw += def.punch_per_shot * 0.25F * (rand_float(s) * 2.0F - 1.0F);
  ++w.shot_index;
  w.idle_ticks = 0;
  w.cooldown_ticks = def.fire_ticks;
}

} // namespace

const WeaponDef& weapon_def(WeaponId id) {
  return kWeapons[id < kWeaponCount ? id : 0];
}

void weapons_reset(SimState& s) {
  WeaponState& w = s.weapon;
  w = {};
  for (std::uint32_t i = 0; i < kWeaponCount; ++i) {
    w.magazine[i] = kWeapons[i].magazine;
    w.reserve[i] = kWeapons[i].reserve;
  }
  w.selected = WeaponAk47;
}

void weapons_run(SimState& s, const InputCommand& cmd) {
  WeaponState& w = s.weapon;

  // Weapon switch cancels reload, brief draw delay.
  if (cmd.weapon != WeaponNone && cmd.weapon < kWeaponCount &&
      static_cast<WeaponId>(cmd.weapon) != w.selected) {
    w.selected = static_cast<WeaponId>(cmd.weapon);
    w.reload_ticks = 0;
    w.cooldown_ticks = 16; // 0.25 s draw
    w.shot_index = 0;
  }

  const WeaponDef& def = kWeapons[w.selected];

  if (w.cooldown_ticks > 0) {
    --w.cooldown_ticks;
  }
  if (w.reload_ticks > 0) {
    --w.reload_ticks;
    if (w.reload_ticks == 0) {
      finish_reload(s);
    }
  }
  ++w.idle_ticks;
  if (w.idle_ticks > def.recovery_ticks) {
    w.shot_index = 0;
  }

  w.punch_pitch *= kPunchDecayPerTick;
  w.punch_yaw *= kPunchDecayPerTick;

  const bool fire = (cmd.buttons & ButtonFire) != 0U;
  const bool fire_edge = fire && !w.fire_held;
  w.fire_held = fire;

  if ((cmd.buttons & ButtonReload) != 0U) {
    start_reload(s);
  }

  const bool wants_shot = def.automatic ? fire : fire_edge;
  if (wants_shot && w.cooldown_ticks == 0 && w.reload_ticks == 0) {
    if (def.magazine == 0) {
      // Knife: melee not implemented yet, just cooldown.
      w.cooldown_ticks = def.fire_ticks;
    } else if (w.magazine[w.selected] > 0) {
      --w.magazine[w.selected];
      fire_shot(s);
    } else if (fire_edge) {
      ShotEvent event = {};
      event.sequence = ++w.shot_sequence;
      event.result = ShotDry;
      s.last_shot = event;
      w.cooldown_ticks = def.fire_ticks;
      start_reload(s);
    }
  }
}

void targets_run(SimState& s) {
  for (std::uint32_t i = 0; i < s.target_count; ++i) {
    TargetState& t = s.targets[i];
    if (t.flash_ticks > 0) {
      --t.flash_ticks;
    }
    if (!t.alive) {
      if (t.respawn_ticks > 0) {
        --t.respawn_ticks;
      } else {
        t.alive = true;
        t.health = kTargetHealth;
      }
      continue;
    }
    if (t.speed != 0.0F && t.patrol_max_x > t.patrol_min_x) {
      t.origin.x += t.speed * kTickSeconds;
      if (t.origin.x > t.patrol_max_x) {
        t.origin.x = t.patrol_max_x;
        t.speed = -t.speed;
      } else if (t.origin.x < t.patrol_min_x) {
        t.origin.x = t.patrol_min_x;
        t.speed = -t.speed;
      }
    }
  }
}

} // namespace cs
