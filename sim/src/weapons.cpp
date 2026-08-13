#include "state.h"
#include "world.h"

#include <cmath>

// Hitscan gunplay: deterministic spray pattern + movement inaccuracy + view
// punch. Bullets ray-trace the brush world and manual AABB hitboxes on the
// other players.
//
// Everything here is indexed by player, not hard-wired to "the" player: a bot
// pulling the trigger runs this same code, so its bullets obey the same spread,
// falloff and hitgroup rules yours do.

namespace cs {
namespace {

constexpr WeaponDef kWeapons[kWeaponCount] = {
    // id, name, mag, reserve, dmg, rangeMod, penetration, spread, patternScale,
    // punch, maxSpeed, fireTicks, reloadTicks, recoveryTicks, automatic, zoomFov
    {WeaponNone, "None", 0, 0, 0.0F, 1.0F, 0.0F, 0.0F, 0.0F, 0.0F, kMaxSpeed, 1, 1, 1, false, {0.0F, 0.0F}},
    {WeaponKnife, "Knife", 0, 0, 55.0F, 1.0F, 0.0F, 0.0F, 0.0F, 0.001F, 250.0F, 25, 1, 1, true, {0.0F, 0.0F}},
    {WeaponUsp, "USP", 12, 100, 34.0F, 0.79F, 10.0F, 0.0045F, 0.72F, 0.014F, 250.0F, 10, 140, 22, false, {0.0F, 0.0F}},
    {WeaponGlock, "Glock", 20, 120, 25.0F, 0.75F, 7.0F, 0.0060F, 0.62F, 0.011F, 250.0F, 9, 145, 20, false, {0.0F, 0.0F}},
    {WeaponAk47, "AK-47", 30, 90, 36.0F, 0.80F, 26.0F, 0.0070F, 1.00F, 0.020F, 221.0F, 6, 160, 16, true, {0.0F, 0.0F}},
    {WeaponM4a1, "M4A1", 30, 90, 33.0F, 0.82F, 22.0F, 0.0055F, 0.82F, 0.016F, 230.0F, 6, 165, 16, true, {0.0F, 0.0F}},
    {WeaponAwp, "AWP", 10, 30, 115.0F, 0.99F, 48.0F, 0.0015F, 1.18F, 0.040F, 210.0F, 95, 235, 60, false, {40.0F, 10.0F}},
    {WeaponMp5, "MP5", 30, 120, 26.0F, 0.84F, 12.0F, 0.0090F, 0.44F, 0.009F, 250.0F, 5, 150, 14, true, {0.0F, 0.0F}},
};

/**
 * What one unit of each material costs a bullet's penetration budget, indexed
 * by cs::Material. Concrete is the reference, so the numbers read as "how much
 * worse than concrete".
 *
 * The consequence, given the maps: a 16u plank partition (5.6) is open to
 * everything down to the Glock, an 8u sheet-metal panel (13.6) is a rifle
 * privilege, a 32u concrete wall (32) is the AWP's alone, and a 96u crate
 * (33.6) is cover — except through a corner, where the ray crosses less of it.
 * That last one falls out of measuring thickness along the actual ray rather
 * than per-surface, and it is the detail that makes learning a map pay.
 */
constexpr float kMaterialHardness[4] = {
    1.00F, // concrete
    0.35F, // wood
    1.70F, // metal
    0.55F, // sand
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
  Vec3 mins; // relative to feet, standing
  Vec3 maxs;
  HitGroup group;
};
constexpr Hitbox kHitboxes[4] = {
    {{-6.0F, 58.0F, -6.0F}, {6.0F, 72.0F, 6.0F}, HitHead},
    {{-12.0F, 38.0F, -7.0F}, {12.0F, 58.0F, 7.0F}, HitChest},
    {{-11.0F, 26.0F, -7.0F}, {11.0F, 38.0F, 7.0F}, HitStomach},
    {{-14.0F, 0.0F, -6.0F}, {14.0F, 26.0F, 6.0F}, HitLimbs},
};

constexpr float kPunchDecayPerTick = 0.82F;

float material_hardness(std::uint32_t material) {
  return kMaterialHardness[material < 4U ? material : MaterialConcrete];
}

float hit_group_multiplier(HitGroup group) {
  switch (group) {
    case HitHead: return 4.0F;
    case HitStomach: return 1.25F;
    case HitLimbs: return 0.75F;
    default: return 1.0F;
  }
}

std::uint32_t zoom_levels(const WeaponDef& def) {
  if (def.zoom_fov[0] <= 0.0F) return 0U;
  return def.zoom_fov[1] > 0.0F ? 2U : 1U;
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

void start_reload(PlayerEntity& e) {
  WeaponState& w = e.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  if (def.magazine == 0 || w.reload_ticks > 0 || w.magazine[w.selected] >= def.magazine ||
      w.reserve[w.selected] == 0) {
    return;
  }
  w.reload_ticks = def.reload_ticks;
  w.zoom = 0U; // you cannot work a bolt down the scope
}

void finish_reload(PlayerEntity& e) {
  WeaponState& w = e.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  const std::uint32_t want = def.magazine - w.magazine[w.selected];
  const std::uint32_t take = want < w.reserve[w.selected] ? want : w.reserve[w.selected];
  w.magazine[w.selected] += take;
  w.reserve[w.selected] -= take;
}

void kill_player(SimState& s, std::uint32_t killer, std::uint32_t victim) {
  PlayerEntity& v = s.players[victim];
  v.alive = false;
  v.health = 0.0F;
  v.respawn_ticks = kRespawnTicks;
  v.move.velocity = {0.0F, 0.0F, 0.0F};
  v.weapon.zoom = 0U;
  ++v.deaths;

  PlayerEntity& k = s.players[killer];
  ++k.kills;
  if (s.mode == ModeTeam && k.team < 3U) {
    ++s.team_score[k.team];
  }

  SimEvent& event = push_event(s, EventDeath, killer);
  event.victim = victim;
  event.weapon = k.weapon.selected;
}

void fire_shot(SimState& s, std::uint32_t shooter) {
  PlayerEntity& e = s.players[shooter];
  WeaponState& w = e.weapon;
  const WeaponDef& def = kWeapons[w.selected];
  const PlayerState& p = e.move;

  ++e.shots;
  SimEvent& event = push_event(s, EventShot, shooter);
  event.weapon = w.selected;

  const Vec3 eye = eye_of(e);
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
  // A scoped weapon fired from the hip is a shotgun with one pellet.
  if (zoom_levels(def) > 0U && w.zoom == 0U) {
    inaccuracy *= kUnscopedSpreadScale;
  }
  const float jitter_x = (rand_float(s) * 2.0F - 1.0F) * inaccuracy;
  const float jitter_y = (rand_float(s) * 2.0F - 1.0F) * inaccuracy;

  // Pattern climbs: impacts walk up the wall as the spray continues.
  const float shot_yaw = p.yaw + pattern.x * def.pattern_scale + jitter_x;
  const float shot_pitch = p.pitch + pattern.y * def.pattern_scale + jitter_y;

  const float cp = std::cos(shot_pitch);
  const Vec3 dir = {-std::sin(shot_yaw) * cp, std::sin(shot_pitch),
                    -std::cos(shot_yaw) * cp};

  // The bullet walks the world one solid at a time. Each brush it crosses
  // spends thickness x hardness out of its budget, and it stops in the first
  // one the budget cannot cover. Restarting just past an exit face is what
  // keeps a wall from being entered twice: a trace that begins solid reports no
  // hit, so the brush the bullet is leaving is invisible to the next query.
  float power = def.penetration;
  float travelled = 0.0F;
  Vec3 from = eye;
  std::uint32_t walls = 0;
  int best_target = -1;
  HitGroup best_group = HitNone;
  float hit_distance = kShotRange; // eye -> wherever the round ended up
  bool stopped_in_world = false;
  std::uint32_t stop_material = 0;

  while (travelled < kShotRange) {
    const float remaining = kShotRange - travelled;
    const Vec3 leg_end = {from.x + dir.x * remaining, from.y + dir.y * remaining,
                          from.z + dir.z * remaining};
    const TraceResult world_trace = world_trace_ray(from, leg_end);
    const float world_dist =
        world_trace.hit ? world_trace.fraction * remaining : remaining;

    // Players in this leg only. ray_aabb clamps entry distance at zero, so a
    // target behind the restart point can never be picked up twice.
    float best_dist = world_dist;
    for (std::uint32_t t = 0; t < s.player_count; ++t) {
      if (!is_enemy(s, shooter, t)) {
        continue;
      }
      const PlayerEntity& victim = s.players[t];
      const Vec3 feet = feet_of(victim);
      // A crouched player is half as tall, so the boxes squash with them.
      const float squash = victim.move.ducked ? 0.5F : 1.0F;
      for (const Hitbox& box : kHitboxes) {
        const Vec3 mins = {feet.x + box.mins.x, feet.y + box.mins.y * squash,
                           feet.z + box.mins.z};
        const Vec3 maxs = {feet.x + box.maxs.x, feet.y + box.maxs.y * squash,
                           feet.z + box.maxs.z};
        const float dist = ray_aabb(from, dir, mins, maxs, best_dist);
        if (dist >= 0.0F && dist < best_dist) {
          best_dist = dist;
          best_target = static_cast<int>(t);
          best_group = box.group;
        }
      }
    }
    if (best_target >= 0) {
      hit_distance = travelled + best_dist;
      break;
    }
    if (!world_trace.hit) {
      hit_distance = travelled + world_dist; // ran out of range in open air
      break;
    }

    const float entry = travelled + world_dist;
    const float thickness =
        (world_trace.exit_fraction - world_trace.fraction) * remaining;
    const float cost = thickness * material_hardness(world_trace.material);
    // `cost >= power` also covers a weapon with no penetration at all, which is
    // why the knife needs no special case.
    if (walls >= kMaxPenetrations || cost >= power) {
      hit_distance = entry;
      stopped_in_world = true;
      stop_material = world_trace.material;
      break;
    }
    power -= cost;
    ++walls;
    travelled = entry + thickness + kPenetrationSkin;
    from = {eye.x + dir.x * travelled, eye.y + dir.y * travelled,
            eye.z + dir.z * travelled};
  }

  event.end = {eye.x + dir.x * hit_distance, eye.y + dir.y * hit_distance,
               eye.z + dir.z * hit_distance};

  if (best_target >= 0) {
    const std::uint32_t victim_index = static_cast<std::uint32_t>(best_target);
    PlayerEntity& victim = s.players[victim_index];
    float damage = def.base_damage * std::pow(def.range_modifier, hit_distance / 500.0F);
    damage *= hit_group_multiplier(best_group);
    // What is left of the budget is what is left of the round. A shot that
    // barely made it through does barely any damage, and one that spent nothing
    // is untouched — no separate falloff curve to keep in sync.
    if (def.penetration > 0.0F) {
      damage *= power / def.penetration;
    }
    victim.health -= damage;
    victim.flash_ticks = kHitFlashTicks;
    event.hit_group = best_group;
    event.victim = victim_index;
    event.damage = damage;
    ++e.hits;
    if (victim.health <= 0.0F) {
      event.result = ShotKill;
      kill_player(s, shooter, victim_index);
    } else {
      event.result = ShotHit;
    }
  } else if (stopped_in_world) {
    event.result = ShotWorld;
    event.material = stop_material;
  } else {
    event.result = ShotMiss;
  }

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

float weapon_base_speed(const PlayerEntity& e) {
  const float base = kWeapons[e.weapon.selected].max_move_speed;
  return e.weapon.zoom > 0U ? base * kZoomSpeedFactor : base;
}

void weapons_reset(PlayerEntity& e, WeaponId selected) {
  WeaponState& w = e.weapon;
  w = {};
  for (std::uint32_t i = 0; i < kWeaponCount; ++i) {
    w.magazine[i] = kWeapons[i].magazine;
    w.reserve[i] = kWeapons[i].reserve;
  }
  w.selected = selected;
}

void weapons_run(SimState& s, std::uint32_t index, const InputCommand& cmd) {
  PlayerEntity& e = s.players[index];
  WeaponState& w = e.weapon;

  // Weapon switch cancels reload, brief draw delay.
  if (cmd.weapon != WeaponNone && cmd.weapon < kWeaponCount &&
      static_cast<WeaponId>(cmd.weapon) != w.selected) {
    w.selected = static_cast<WeaponId>(cmd.weapon);
    // Deliberate picks stick: dying should not silently put the AWP back in
    // the locker and hand you a rifle.
    e.loadout = w.selected;
    w.reload_ticks = 0;
    w.cooldown_ticks = 16; // 0.25 s draw
    w.shot_index = 0;
    w.zoom = 0U;
  }

  const WeaponDef& def = kWeapons[w.selected];

  // Secondary fire cycles the scope: hip -> 1x -> 2x -> hip.
  const bool zoom = (cmd.buttons & ButtonZoom) != 0U;
  const bool zoom_edge = zoom && !w.zoom_held;
  w.zoom_held = zoom;
  const std::uint32_t levels = zoom_levels(def);
  if (zoom_edge && levels > 0U && w.reload_ticks == 0U) {
    w.zoom = w.zoom >= levels ? 0U : w.zoom + 1U;
  }
  if (levels == 0U) {
    w.zoom = 0U;
  }

  if (w.cooldown_ticks > 0) {
    --w.cooldown_ticks;
  }
  if (w.reload_ticks > 0) {
    --w.reload_ticks;
    if (w.reload_ticks == 0) {
      finish_reload(e);
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
    start_reload(e);
  }

  const bool wants_shot = def.automatic ? fire : fire_edge;
  if (wants_shot && w.cooldown_ticks == 0 && w.reload_ticks == 0) {
    if (def.magazine == 0) {
      // Knife: melee not implemented yet, just cooldown.
      w.cooldown_ticks = def.fire_ticks;
    } else if (w.magazine[w.selected] > 0) {
      --w.magazine[w.selected];
      fire_shot(s, index);
    } else if (fire_edge) {
      SimEvent& event = push_event(s, EventShot, index);
      event.result = ShotDry;
      event.weapon = w.selected;
      w.cooldown_ticks = def.fire_ticks;
      start_reload(e);
    }
  }
}

} // namespace cs
