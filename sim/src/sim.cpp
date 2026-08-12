#include "state.h"
#include "world.h"

#include <cmath>
#include <cstring>

// Sim orchestration + C ABI. One global sim instance holding a flat roster of
// players; index kLocalPlayer is the one the client drives, the rest are bots.
// Every entity goes through the same pmove/weapons path, which is what keeps a
// future authoritative server honest — it will run this file unchanged.

namespace cs {
namespace {

SimState g_state;

// Bots draw from a small rotation so a match has more than one gun in it.
constexpr WeaponId kBotWeapons[4] = {WeaponAk47, WeaponM4a1, WeaponMp5, WeaponAwp};

void reset_movement(PlayerEntity& e, Vec3 origin, float yaw) {
  e.move = {};
  e.move.origin = origin;
  e.move.yaw = yaw;
  e.move.view_offset = kEyeAboveCenterStand;
}

/**
 * Furthest spawn point from any living enemy, restricted to the ones this
 * player's team may use. The classic deathmatch rule, and the only thing
 * standing between a respawn and being shot mid-materialization.
 */
const SpawnPoint* choose_spawn(SimState& s, std::uint32_t index) {
  const PlayerEntity& self = s.players[index];
  const SpawnPoint* best = nullptr;
  float best_score = -1.0F;

  for (std::uint32_t i = 0; i < s.spawn_count; ++i) {
    const SpawnPoint& spawn = s.spawns[i];
    if (spawn.team != TeamNone && self.team != TeamNone && spawn.team != self.team) {
      continue;
    }
    float score = 1e9F;
    for (std::uint32_t j = 0; j < s.player_count; ++j) {
      if (j == index || !s.players[j].alive || !s.players[j].active) {
        continue;
      }
      if (s.mode == ModeTeam && s.players[j].team == self.team) {
        continue;
      }
      const Vec3 other = s.players[j].move.origin;
      const float dx = other.x - spawn.origin.x;
      const float dy = other.y - spawn.origin.y;
      const float dz = other.z - spawn.origin.z;
      const float dist = std::sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < score) {
        score = dist;
      }
    }
    // Jitter so a fixed roster doesn't queue up on one pad every round.
    score += rand_float(s) * 64.0F;
    if (score > best_score) {
      best_score = score;
      best = &spawn;
    }
  }
  return best;
}

void place_player(SimState& s, std::uint32_t index, const SpawnPoint* spawn) {
  PlayerEntity& e = s.players[index];
  const Vec3 origin =
      spawn != nullptr ? spawn->origin : Vec3{0.0F, kHullHalfHeightStand + 1.0F, 0.0F};
  const float yaw = spawn != nullptr ? spawn->yaw : 0.0F;

  reset_movement(e, origin, yaw);
  e.health = kPlayerHealth;
  e.alive = true;
  e.respawn_ticks = 0;
  e.flash_ticks = 0;
  if (e.loadout == WeaponNone) {
    e.loadout = e.is_bot ? kBotWeapons[index % 4U] : WeaponAk47;
  }
  weapons_reset(e, e.loadout);
  if (e.is_bot) {
    bot_reset(s, index, e.bot.skill);
  }
}

void respawn_player(SimState& s, std::uint32_t index) {
  place_player(s, index, choose_spawn(s, index));
}

/**
 * Push overlapping players apart along the shallower horizontal axis.
 *
 * Full hull-vs-hull sweeps inside pmove would be the "correct" fix, but they
 * also introduce every wedging failure mode the world trace spent v3 getting
 * right — with ten hulls shoving each other every tick. A separation pass after
 * everyone has moved buys the thing that actually matters (nobody stands inside
 * you) at a fraction of the risk: pushes are bounded, symmetric, and rejected
 * outright if they would drive a hull into the world.
 */
void separate_players(SimState& s) {
  constexpr float kSlop = 0.5F;
  const float width = 2.0F * kHullHalfWidth;
  for (std::uint32_t i = 0; i < s.player_count; ++i) {
    PlayerEntity& a = s.players[i];
    if (!a.active || !a.alive) {
      continue;
    }
    const float half_a = a.move.ducked ? kHullHalfHeightDuck : kHullHalfHeightStand;
    for (std::uint32_t j = i + 1; j < s.player_count; ++j) {
      PlayerEntity& b = s.players[j];
      if (!b.active || !b.alive) {
        continue;
      }
      const float half_b = b.move.ducked ? kHullHalfHeightDuck : kHullHalfHeightStand;
      const float dy = a.move.origin.y - b.move.origin.y;
      if ((dy < 0.0F ? -dy : dy) >= half_a + half_b) {
        continue; // one is standing on the other's head, not inside them
      }
      const float dx = a.move.origin.x - b.move.origin.x;
      const float dz = a.move.origin.z - b.move.origin.z;
      const float overlap_x = width - (dx < 0.0F ? -dx : dx);
      const float overlap_z = width - (dz < 0.0F ? -dz : dz);
      if (overlap_x <= 0.0F || overlap_z <= 0.0F) {
        continue;
      }

      Vec3 push = {0.0F, 0.0F, 0.0F};
      if (overlap_x < overlap_z) {
        // Perfectly coincident hulls have no axis to pick, so index order does.
        const float sign = dx != 0.0F ? (dx > 0.0F ? 1.0F : -1.0F) : 1.0F;
        push.x = sign * (overlap_x + kSlop) * 0.5F;
      } else {
        const float sign = dz != 0.0F ? (dz > 0.0F ? 1.0F : -1.0F) : 1.0F;
        push.z = sign * (overlap_z + kSlop) * 0.5F;
      }

      const Vec3 half_vec_a = {kHullHalfWidth, half_a, kHullHalfWidth};
      const Vec3 half_vec_b = {kHullHalfWidth, half_b, kHullHalfWidth};
      const Vec3 to_a = {a.move.origin.x + push.x, a.move.origin.y,
                         a.move.origin.z + push.z};
      const Vec3 to_b = {b.move.origin.x - push.x, b.move.origin.y,
                         b.move.origin.z - push.z};
      if (!world_overlap_hull(to_a, half_vec_a)) {
        a.move.origin = to_a;
      }
      if (!world_overlap_hull(to_b, half_vec_b)) {
        b.move.origin = to_b;
      }
    }
  }
}

void run_player(SimState& s, std::uint32_t index, const InputCommand& cmd) {
  PlayerEntity& e = s.players[index];
  pmove_run(e.move, cmd, weapon_base_speed(e));
  if (e.move.stepped || e.move.land_speed > 0.0F) {
    SimEvent& event = push_event(s, EventStep, index);
    event.result = e.move.land_speed > kLandingSpeed ? StepLand : StepWalk;
    event.material = e.move.ground_material;
    event.start = feet_of(e);
    event.end = event.start;
  }
  weapons_run(s, index, cmd);
  if (e.flash_ticks > 0) {
    --e.flash_ticks;
  }
}

} // namespace

SimState& state() { return g_state; }

bool is_enemy(const SimState& s, std::uint32_t viewer, std::uint32_t other) {
  if (other == viewer || other >= s.player_count) {
    return false;
  }
  const PlayerEntity& target = s.players[other];
  if (!target.active || !target.alive) {
    return false;
  }
  // Free-for-all has no teams, so TeamNone players are hostile to everyone.
  return s.mode != ModeTeam || target.team != s.players[viewer].team;
}

SimEvent& push_event(SimState& s, EventKind kind, std::uint32_t actor) {
  // Overflow overwrites the last slot rather than growing the snapshot: with
  // per-weapon cooldowns a full roster cannot legitimately produce kMaxEvents
  // in one tick, and a dropped tracer is cheaper than a resized ABI.
  const std::uint32_t index =
      s.event_count < kMaxEvents ? s.event_count : kMaxEvents - 1U;
  if (s.event_count < kMaxEvents) {
    ++s.event_count;
  }
  SimEvent& event = s.events[index];
  event = {};
  event.kind = kind;
  event.actor = actor;
  event.victim = kMaxPlayers;
  return event;
}

void refresh_snapshot(SimState& s) {
  SimSnapshot& snap = s.snapshot;
  const PlayerEntity& local = s.players[kLocalPlayer];

  snap.api_version = kSimApiVersion;
  snap.tick = s.tick;
  snap.mode = s.mode;
  snap.local_index = kLocalPlayer;

  snap.origin = local.move.origin;
  snap.velocity = local.move.velocity;
  snap.eye_height = local.move.view_offset;
  snap.speed_h = std::sqrt(local.move.velocity.x * local.move.velocity.x +
                           local.move.velocity.z * local.move.velocity.z);
  snap.stamina = local.move.stamina;

  const WeaponDef& def = weapon_def(local.weapon.selected);
  snap.fov = local.weapon.zoom > 0U ? def.zoom_fov[local.weapon.zoom - 1U] : kBaseFov;
  snap.flags = (local.move.on_ground ? SnapOnGround : 0U) |
               (local.move.ducked ? SnapDucked : 0U) |
               (local.alive ? SnapAlive : 0U);
  snap.zoom = local.weapon.zoom;
  snap.weapon = local.weapon.selected;
  snap.magazine = local.weapon.magazine[local.weapon.selected];
  snap.reserve = local.weapon.reserve[local.weapon.selected];
  snap.cooldown_ticks = local.weapon.cooldown_ticks;
  snap.reload_ticks = local.weapon.reload_ticks;
  snap.punch_pitch = local.weapon.punch_pitch;
  snap.punch_yaw = local.weapon.punch_yaw;
  snap.health = local.health;
  snap.respawn_ticks = local.respawn_ticks;
  snap.kills = local.kills;
  snap.deaths = local.deaths;
  snap.hits = local.hits;
  snap.shots = local.shots;

  for (std::uint32_t i = 0; i < 3; ++i) {
    snap.team_score[i] = s.team_score[i];
  }
  snap.player_count = s.player_count;

  for (std::uint32_t i = 0; i < kMaxPlayers; ++i) {
    const PlayerEntity& e = s.players[i];
    PlayerSnapshot& out = snap.players[i];
    out.origin = e.move.origin;
    out.yaw = e.move.yaw;
    out.pitch = e.move.pitch;
    out.health = e.health;
    out.speed_h = std::sqrt(e.move.velocity.x * e.move.velocity.x +
                            e.move.velocity.z * e.move.velocity.z);
    out.team = e.team;
    out.flags = (e.move.on_ground ? SnapOnGround : 0U) |
                (e.move.ducked ? SnapDucked : 0U) | (e.alive ? SnapAlive : 0U);
    out.weapon = e.weapon.selected;
    out.kills = e.kills;
    out.deaths = e.deaths;
    out.flash_ticks = e.flash_ticks;
    out.is_bot = e.is_bot ? 1U : 0U;
  }

  snap.event_count = s.event_count;
  for (std::uint32_t i = 0; i < kMaxEvents; ++i) {
    snap.events[i] = i < s.event_count ? s.events[i] : SimEvent{};
  }
}

std::uint64_t state_hash(const SimState& s) {
  // FNV-1a over the deterministic core (roster + spawns + rng + tick).
  std::uint64_t hash = 1469598103934665603ULL;
  auto mix = [&hash](const void* data, std::size_t bytes) {
    const auto* p = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < bytes; ++i) {
      hash ^= p[i];
      hash *= 1099511628211ULL;
    }
  };
  mix(&s.players, sizeof(s.players));
  mix(&s.player_count, sizeof(s.player_count));
  mix(&s.mode, sizeof(s.mode));
  mix(&s.team_score, sizeof(s.team_score));
  mix(&s.spawns, sizeof(s.spawns));
  mix(&s.spawn_count, sizeof(s.spawn_count));
  mix(&s.rng, sizeof(s.rng));
  mix(&s.tick, sizeof(s.tick));
  return hash;
}

} // namespace cs

using cs::g_state;

extern "C" {

void sim_create() {
  cs::world_create();
  std::memset(&g_state, 0, sizeof(g_state));
  g_state.rng = 0x9E3779B9U;
  g_state.mode = cs::ModeRange;
  g_state.player_count = 1;

  cs::PlayerEntity& local = g_state.players[cs::kLocalPlayer];
  local.active = true;
  local.is_bot = false;
  local.team = cs::TeamNone;
  cs::reset_movement(local, {0.0F, cs::kHullHalfHeightStand + 1.0F, 0.0F}, 0.0F);
  local.health = cs::kPlayerHealth;
  local.alive = true;
  local.loadout = cs::WeaponAk47;
  cs::weapons_reset(local, local.loadout);

  cs::refresh_snapshot(g_state);
}

void sim_world_reset() {
  cs::world_reset();
  g_state.spawn_count = 0;
  // The roster belongs to the map that is being torn down; keep only the local
  // player so a rebuilt world never inherits bots standing in old geometry.
  for (std::uint32_t i = 1; i < cs::kMaxPlayers; ++i) {
    g_state.players[i] = {};
  }
  g_state.player_count = 1;
}

void sim_add_box(float min_x, float min_y, float min_z, float max_x, float max_y,
                 float max_z, std::uint32_t material) {
  cs::world_add_box({min_x, min_y, min_z}, {max_x, max_y, max_z}, material);
}

int sim_add_brush(const float* planes, std::uint32_t plane_count,
                  std::uint32_t material) {
  return cs::world_add_brush(planes, plane_count, material) ? 1 : 0;
}

void sim_world_finalize() { cs::world_finalize(); }

int sim_trace_ray(float start_x, float start_y, float start_z, float end_x,
                  float end_y, float end_z, float* out_hit) {
  const cs::TraceResult trace =
      cs::world_trace_ray({start_x, start_y, start_z}, {end_x, end_y, end_z});
  if (out_hit != nullptr) {
    out_hit[0] = trace.fraction;
    out_hit[1] = trace.end.x;
    out_hit[2] = trace.end.y;
    out_hit[3] = trace.end.z;
    out_hit[4] = trace.normal.x;
    out_hit[5] = trace.normal.y;
    out_hit[6] = trace.normal.z;
  }
  return trace.hit ? 1 : 0;
}

void sim_add_spawn(float x, float y, float z, float yaw, std::uint32_t team) {
  if (g_state.spawn_count >= cs::kMaxSpawns) {
    return;
  }
  cs::SpawnPoint& spawn = g_state.spawns[g_state.spawn_count++];
  spawn.origin = {x, y, z};
  spawn.yaw = yaw;
  spawn.team = team <= cs::TeamCt ? team : cs::TeamNone;
}

std::uint32_t sim_add_bot(float x, float y, float z, float yaw,
                          std::uint32_t team, float skill) {
  if (g_state.player_count >= cs::kMaxPlayers) {
    return cs::kMaxPlayers;
  }
  const std::uint32_t index = g_state.player_count++;
  cs::PlayerEntity& e = g_state.players[index];
  e = {};
  e.active = true;
  e.is_bot = true;
  e.team = team <= cs::TeamCt ? team : cs::TeamNone;
  e.health = cs::kPlayerHealth;
  e.alive = true;
  e.loadout = cs::kBotWeapons[index % 4U];
  cs::reset_movement(e, {x, y, z}, yaw);
  cs::weapons_reset(e, e.loadout);
  cs::bot_reset(g_state, index, skill);
  cs::refresh_snapshot(g_state);
  return index;
}

void sim_start_match(std::uint32_t mode, std::uint32_t bot_count, float skill) {
  g_state.mode = mode <= cs::ModeTeam ? mode : cs::ModeDeathmatch;
  g_state.team_score[0] = 0;
  g_state.team_score[1] = 0;
  g_state.team_score[2] = 0;

  const std::uint32_t bots =
      bot_count > cs::kMaxPlayers - 1U ? cs::kMaxPlayers - 1U : bot_count;
  g_state.player_count = bots + 1U;

  // Restarting a match (the menu's bot slider does exactly that) should not
  // confiscate the gun you chose to be holding.
  const cs::WeaponId kept = g_state.players[cs::kLocalPlayer].loadout;

  // Two passes: wipe the whole roster before placing anyone, so spawn choice
  // never sees a corpse from the previous match standing in the way.
  for (std::uint32_t i = 0; i < cs::kMaxPlayers; ++i) {
    cs::PlayerEntity& e = g_state.players[i];
    e = {};
    if (i == cs::kLocalPlayer) {
      e.loadout = kept;
    }
    e.active = i < g_state.player_count;
    e.is_bot = i != cs::kLocalPlayer;
    // Teams alternate so the sides stay even; you always start on CT.
    e.team = g_state.mode == cs::ModeTeam
                 ? (i % 2U == 0U ? cs::TeamCt : cs::TeamT)
                 : cs::TeamNone;
    e.bot.skill = skill;
  }
  // The map's first spawn is where the level wants you to enter, so the opening
  // placement is authored rather than scored. Every later respawn uses the
  // furthest-from-an-enemy rule.
  if (g_state.spawn_count > 0U) {
    cs::place_player(g_state, cs::kLocalPlayer, &g_state.spawns[0]);
  } else {
    cs::respawn_player(g_state, cs::kLocalPlayer);
  }
  for (std::uint32_t i = 1; i < g_state.player_count; ++i) {
    cs::respawn_player(g_state, i);
  }
  g_state.event_count = 0;
  cs::refresh_snapshot(g_state);
}

void sim_spawn(float x, float y, float z, float yaw) {
  cs::PlayerEntity& local = g_state.players[cs::kLocalPlayer];
  cs::reset_movement(local, {x, y, z}, yaw);
  local.health = cs::kPlayerHealth;
  local.alive = true;
  local.respawn_ticks = 0;
  local.weapon.zoom = 0U;
  cs::refresh_snapshot(g_state);
}

void sim_step(float forward, float strafe, float yaw, float pitch,
              std::uint32_t buttons, std::uint32_t weapon) {
  g_state.event_count = 0;

  cs::InputCommand cmd = {forward, strafe, yaw, pitch, buttons, weapon};
  if (cmd.forward > 1.0F) cmd.forward = 1.0F;
  if (cmd.forward < -1.0F) cmd.forward = -1.0F;
  if (cmd.strafe > 1.0F) cmd.strafe = 1.0F;
  if (cmd.strafe < -1.0F) cmd.strafe = -1.0F;

  for (std::uint32_t i = 0; i < g_state.player_count; ++i) {
    cs::PlayerEntity& e = g_state.players[i];
    if (!e.active) {
      continue;
    }
    if (!e.alive) {
      if (e.respawn_ticks > 0) {
        --e.respawn_ticks;
      } else {
        cs::respawn_player(g_state, i);
      }
      continue;
    }
    cs::run_player(g_state, i, e.is_bot ? cs::bot_think(g_state, i) : cmd);
  }
  cs::separate_players(g_state);

  ++g_state.tick;
  cs::refresh_snapshot(g_state);
}

const cs::SimSnapshot* sim_snapshot() { return &g_state.snapshot; }

std::uint32_t sim_snapshot_bytes() {
  return static_cast<std::uint32_t>(sizeof(cs::SimSnapshot));
}
}
