#include "cs/server.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace cs::server {
namespace {

struct NavNode {
  Vec3 origin;
  std::array<std::uint8_t, 3> neighbors;
  std::uint8_t neighbor_count;
};

struct SpawnPoint {
  Vec3 origin;
  float yaw;
};

constexpr std::array<SpawnPoint, net::kMaxPlayers> kFfaSpawns{{
  {{0.0F, kStandingHalfHeight, 500.0F}, 0.0F},
  {{0.0F, kStandingHalfHeight, -500.0F}, 3.141593F},
  {{-650.0F, kStandingHalfHeight, 500.0F}, 0.915101F},
  {{650.0F, kStandingHalfHeight, -500.0F}, -2.226492F},
  {{650.0F, kStandingHalfHeight, 500.0F}, -0.915101F},
  {{-650.0F, kStandingHalfHeight, -500.0F}, 2.226492F},
  {{-700.0F, kStandingHalfHeight, 0.0F}, 1.570796F},
  {{700.0F, kStandingHalfHeight, 0.0F}, -1.570796F},
}};

constexpr std::array<NavNode, 10> kAimArenaNavigation{{
  {{0.0F, kStandingHalfHeight, 500.0F}, {1, 2, 0}, 2},
  {{-180.0F, kStandingHalfHeight, 300.0F}, {0, 3, 0}, 2},
  {{180.0F, kStandingHalfHeight, 300.0F}, {0, 4, 0}, 2},
  {{-180.0F, kStandingHalfHeight, 80.0F}, {1, 5, 0}, 2},
  {{180.0F, kStandingHalfHeight, 80.0F}, {2, 6, 0}, 2},
  {{-180.0F, kStandingHalfHeight, -160.0F}, {3, 7, 0}, 2},
  {{180.0F, kStandingHalfHeight, -160.0F}, {4, 7, 0}, 2},
  {{0.0F, kStandingHalfHeight, -250.0F}, {5, 6, 8}, 3},
  {{0.0F, kStandingHalfHeight, -400.0F}, {7, 9, 0}, 2},
  {{0.0F, kStandingHalfHeight, -500.0F}, {8, 0, 0}, 1},
}};

float horizontal_distance_squared(Vec3 first, Vec3 second) {
  const float x = first.x - second.x;
  const float z = first.z - second.z;
  return x * x + z * z;
}

std::uint8_t closest_nav_node(Vec3 origin) {
  std::uint8_t closest = 0;
  float closest_distance = std::numeric_limits<float>::max();
  for (std::uint8_t index = 0; index < kAimArenaNavigation.size(); ++index) {
    const float distance = horizontal_distance_squared(
      origin,
      kAimArenaNavigation[index].origin
    );
    if (distance < closest_distance) {
      closest_distance = distance;
      closest = index;
    }
  }
  return closest;
}

float nav_heuristic(std::uint8_t first, std::uint8_t second) {
  return std::sqrt(horizontal_distance_squared(
    kAimArenaNavigation[first].origin,
    kAimArenaNavigation[second].origin
  ));
}

std::uint8_t next_nav_node(Vec3 origin, Vec3 destination) {
  const std::uint8_t start = closest_nav_node(origin);
  const std::uint8_t goal = closest_nav_node(destination);
  if (start == goal) return goal;

  constexpr std::uint8_t none = static_cast<std::uint8_t>(kAimArenaNavigation.size());
  std::array<float, kAimArenaNavigation.size()> distance{};
  std::array<float, kAimArenaNavigation.size()> score{};
  std::array<std::uint8_t, kAimArenaNavigation.size()> previous{};
  std::array<bool, kAimArenaNavigation.size()> visited{};
  distance.fill(std::numeric_limits<float>::max());
  score.fill(std::numeric_limits<float>::max());
  previous.fill(none);
  distance[start] = 0.0F;
  score[start] = nav_heuristic(start, goal);

  for (std::size_t iteration = 0; iteration < kAimArenaNavigation.size(); ++iteration) {
    std::uint8_t current = none;
    float best = std::numeric_limits<float>::max();
    for (std::uint8_t node = 0; node < kAimArenaNavigation.size(); ++node) {
      if (!visited[node] && score[node] < best) {
        best = score[node];
        current = node;
      }
    }
    if (current == none || current == goal) break;
    visited[current] = true;
    const NavNode& node = kAimArenaNavigation[current];
    for (std::uint8_t index = 0; index < node.neighbor_count; ++index) {
      const std::uint8_t neighbor = node.neighbors[index];
      const float candidate = distance[current] + nav_heuristic(current, neighbor);
      if (candidate >= distance[neighbor]) continue;
      previous[neighbor] = current;
      distance[neighbor] = candidate;
      score[neighbor] = candidate + nav_heuristic(neighbor, goal);
    }
  }

  if (previous[goal] == none) return goal;
  std::uint8_t next = goal;
  while (previous[next] != start && previous[next] != none) next = previous[next];
  return next;
}

const SpawnPoint& spawn_for(std::uint8_t player_id) {
  return kFfaSpawns[player_id % kFfaSpawns.size()];
}

void reset_simulation(Player& player) {
  cs::initialize(player.simulation);
  clear_targets(player.simulation);
  const SpawnPoint& spawn = spawn_for(player.id);
  set_player(player.simulation, spawn.origin);
  player.simulation.player.yaw = spawn.yaw;
  refresh_snapshot(player.simulation);
  player.health = 100;
  player.alive = true;
  player.respawn_ticks = 0;
  player.last_command = {};
  player.bot_state = {};
}

const Player* closest_target(const Server& server, const Player& bot) {
  const Player* closest = nullptr;
  float closest_distance = std::numeric_limits<float>::max();
  for (const Player& player : server.players) {
    if (!player.connected || !player.alive || player.id == bot.id) continue;
    const float distance = horizontal_distance_squared(
      bot.simulation.player.origin,
      player.simulation.player.origin
    );
    if (distance < closest_distance) {
      closest_distance = distance;
      closest = &player;
    }
  }
  return closest;
}

InputCommand bot_command(Server& server, Player& bot) {
  const Player* target = closest_target(server, bot);
  if (target == nullptr) return {};
  if (bot.bot_state.target_id != target->id) {
    bot.bot_state.target_id = target->id;
    bot.bot_state.reaction_ticks = 10U + static_cast<std::uint32_t>(bot.id) * 3U;
  } else if (bot.bot_state.reaction_ticks > 0) {
    --bot.bot_state.reaction_ticks;
  }

  const Vec3 origin = bot.simulation.player.origin;
  const Vec3 target_origin = target->simulation.player.origin;
  const float target_x = target_origin.x - origin.x;
  const float target_y = target_origin.y - origin.y - 16.0F;
  const float target_z = target_origin.z - origin.z;
  const float target_distance = std::sqrt(target_x * target_x + target_z * target_z);
  const float aim_error = std::sin(
    static_cast<float>(server.tick + static_cast<std::uint32_t>(bot.id) * 37U) * 0.045F
  ) * 0.006F;
  InputCommand command{
    .yaw = std::atan2(target_x, -target_z) + aim_error,
    .pitch = std::atan2(target_y, std::max(target_distance, 1.0F)),
  };

  if (bot.simulation.weapon.magazine[WeaponAk47] == 0U) {
    command.buttons |= ButtonReload;
  } else if (bot.bot_state.reaction_ticks == 0 && target_distance < 350.0F) {
    command.buttons |= ButtonFire;
  }

  if (target_distance > 170.0F) {
    const std::uint8_t start = closest_nav_node(origin);
    const std::uint8_t goal = closest_nav_node(target_origin);
    const Vec3 destination = start == goal ? target_origin :
      kAimArenaNavigation[next_nav_node(origin, target_origin)].origin;
    const float move_x = destination.x - origin.x;
    const float move_z = destination.z - origin.z;
    const float move_length = std::sqrt(move_x * move_x + move_z * move_z);
    if (move_length > 8.0F) {
      const float direction_x = move_x / move_length;
      const float direction_z = move_z / move_length;
      const float forward_x = std::sin(command.yaw);
      const float forward_z = -std::cos(command.yaw);
      const float right_x = std::cos(command.yaw);
      const float right_z = std::sin(command.yaw);
      command.forward = direction_x * forward_x + direction_z * forward_z;
      command.strafe = direction_x * right_x + direction_z * right_z;
    }
  }
  return command;
}

void record_history(Server& server) {
  HistoryFrame& frame = server.history[server.tick % kPositionHistory];
  frame = {};
  frame.tick = server.tick;
  frame.valid = true;
  for (const Player& player : server.players) {
    if (!player.connected) continue;
    frame.players[player.id] = {
      .origin = player.simulation.player.origin,
      .alive = player.alive,
      .ducked = player.simulation.player.ducked,
    };
  }
}

const HistoryFrame* history_at(const Server& server, std::uint32_t tick) {
  const HistoryFrame& frame = server.history[tick % kPositionHistory];
  if (!frame.valid || frame.tick != tick) return nullptr;
  return &frame;
}

void prepare_targets(Server& server, Player& shooter, std::uint32_t view_tick) {
  clear_targets(shooter.simulation);
  shooter.target_player_count = 0;
  const bool valid_rewind = view_tick <= server.tick &&
    server.tick - view_tick <= kMaxLagCompensationTicks;
  const HistoryFrame* history = valid_rewind ? history_at(server, view_tick) : nullptr;

  for (const Player& target : server.players) {
    if (!target.connected || !target.alive || target.id == shooter.id) continue;
    Vec3 origin = target.simulation.player.origin;
    bool ducked = target.simulation.player.ducked;
    if (history != nullptr) {
      if (!history->players[target.id].alive) continue;
      origin = history->players[target.id].origin;
      ducked = history->players[target.id].ducked;
    }
    const float half_height = ducked ?
      kDuckedHalfHeight : kStandingHalfHeight;
    origin.y -= half_height;
    if (!add_target(shooter.simulation, origin, origin.x, origin.x, 0.0F)) break;
    TargetState& sim_target = shooter.simulation.targets[shooter.simulation.target_count - 1U];
    sim_target.health = static_cast<float>(target.health);
    sim_target.alive = true;
    shooter.target_player_ids[shooter.target_player_count++] = target.id;
  }
}

InputCommand command_for_tick(Player& player, std::uint32_t& view_tick) {
  const std::uint32_t sequence = player.next_input_sequence;
  QueuedCommand& queued = player.input_queue[sequence % kCommandHistory];
  if (queued.valid && queued.command.sequence == sequence) {
    player.last_command = queued.command;
    queued = {};
    player.last_processed_sequence = sequence;
    ++player.next_input_sequence;
  } else if (player.highest_received_sequence >= sequence + net::kInputRedundancy) {
    player.last_processed_sequence = sequence;
    ++player.next_input_sequence;
  }
  view_tick = player.last_command.view_tick;
  return player.last_command.input;
}

void apply_shot(Server& server, Player& shooter) {
  const ShotEvent& shot = shooter.simulation.last_shot;
  if (
    shot.sequence == 0 ||
    (shot.result != ShotHit && shot.result != ShotKill) ||
    shot.target_index >= shooter.target_player_count
  ) {
    return;
  }
  const std::uint8_t victim_id = shooter.target_player_ids[shot.target_index];
  Player& victim = server.players[victim_id];
  if (!victim.connected || !victim.alive) return;
  const std::uint16_t damage = static_cast<std::uint16_t>(std::max(1.0F, std::ceil(shot.damage)));
  if (damage < victim.health) {
    victim.health = static_cast<std::uint16_t>(victim.health - damage);
    return;
  }
  victim.health = 0;
  victim.alive = false;
  victim.respawn_ticks = kRespawnTicks;
  ++victim.deaths;
  ++shooter.kills;
}

std::uint8_t player_flags(const Player& player) {
  std::uint8_t flags = player.connected ? net::SnapshotActive : 0U;
  if (player.alive) flags |= net::SnapshotAlive;
  if (player.simulation.player.on_ground) flags |= net::SnapshotOnGround;
  if (player.simulation.player.ducked) flags |= net::SnapshotDucked;
  if (player.simulation.player.jump_held) flags |= net::SnapshotJumpHeld;
  if (player.simulation.weapon.fire_held) flags |= net::SnapshotFireHeld;
  return flags;
}

}  // namespace

void initialize(Server& server) {
  server = {};
  for (std::uint8_t id = 0; id < net::kMaxPlayers; ++id) {
    server.players[id].id = id;
  }
  record_history(server);
}

int connect(Server& server) {
  for (Player& player : server.players) {
    if (player.connected) continue;
    const std::uint8_t id = player.id;
    player = {};
    player.id = id;
    player.connected = true;
    reset_simulation(player);
    record_history(server);
    return id;
  }
  return -1;
}

int connect_bot(Server& server) {
  const int player_id = connect(server);
  if (player_id >= 0) server.players[static_cast<std::size_t>(player_id)].bot = true;
  return player_id;
}

void disconnect(Server& server, std::uint8_t player_id) {
  if (player_id >= net::kMaxPlayers) return;
  Player& player = server.players[player_id];
  player = {};
  player.id = player_id;
  record_history(server);
}

bool receive_input(Server& server, const net::InputPacket& packet) {
  Player* player = find_player(server, packet.player_id);
  if (
    player == nullptr ||
    player->bot ||
    packet.command_count == 0 ||
    packet.command_count > net::kInputRedundancy
  ) {
    return false;
  }
  std::uint32_t previous_sequence = 0;
  for (std::uint32_t index = 0; index < packet.command_count; ++index) {
    const net::Command& command = packet.commands[index];
    if (
      command.sequence == 0 ||
      command.sequence <= previous_sequence ||
      command.sequence > packet.newest_sequence ||
      !std::isfinite(command.input.forward) ||
      !std::isfinite(command.input.strafe) ||
      !std::isfinite(command.input.yaw) ||
      !std::isfinite(command.input.pitch) ||
      std::fabs(command.input.forward) > 1.001F ||
      std::fabs(command.input.strafe) > 1.001F ||
      command.input.requested_weapon >= kWeaponCount ||
      (command.input.buttons & ~0x0FU) != 0U ||
      (
        command.sequence >= player->next_input_sequence &&
        command.sequence - player->next_input_sequence >= kCommandHistory
      )
    ) {
      return false;
    }
    previous_sequence = command.sequence;
  }
  if (previous_sequence != packet.newest_sequence) return false;

  for (std::uint32_t index = 0; index < packet.command_count; ++index) {
    const net::Command& command = packet.commands[index];
    player->highest_received_sequence = std::max(
      player->highest_received_sequence,
      command.sequence
    );
    if (
      command.sequence < player->next_input_sequence ||
      command.sequence - player->next_input_sequence >= kCommandHistory
    ) {
      continue;
    }
    player->input_queue[command.sequence % kCommandHistory] = {
      .valid = true,
      .command = command,
    };
  }
  return true;
}

void step(Server& server) {
  for (Player& player : server.players) {
    if (!player.connected) continue;
    if (!player.alive) {
      std::uint32_t ignored_view_tick = server.tick;
      (void)command_for_tick(player, ignored_view_tick);
      if (player.respawn_ticks > 0) --player.respawn_ticks;
      if (player.respawn_ticks == 0) reset_simulation(player);
      continue;
    }
    std::uint32_t view_tick = server.tick;
    const InputCommand input = player.bot ?
      bot_command(server, player) : command_for_tick(player, view_tick);
    prepare_targets(server, player, view_tick);
    const std::uint32_t previous_shot = player.simulation.last_shot.sequence;
    cs::step(player.simulation, input);
    if (player.simulation.last_shot.sequence != previous_shot) {
      apply_shot(server, player);
    }
  }
  ++server.tick;
  record_history(server);
}

net::SnapshotPacket snapshot(Server& server, std::uint8_t recipient_id) {
  net::SnapshotPacket packet{
    .sequence = ++server.snapshot_sequence,
    .server_tick = server.tick,
    .recipient_id = recipient_id,
  };
  const Player* recipient = find_player(server, recipient_id);
  if (recipient != nullptr) packet.ack_input = recipient->last_processed_sequence;
  for (const Player& player : server.players) {
    if (!player.connected) continue;
    const WeaponId weapon = player.simulation.weapon.selected;
    packet.players[packet.player_count++] = {
      .id = player.id,
      .flags = player_flags(player),
      .health = player.health,
      .kills = player.kills,
      .deaths = player.deaths,
      .origin = player.simulation.player.origin,
      .velocity = player.simulation.player.velocity,
      .yaw = player.simulation.player.yaw,
      .stamina = player.simulation.player.stamina,
      .weapon = static_cast<std::uint32_t>(weapon),
      .magazine = player.simulation.weapon.magazine[weapon],
      .reserve = player.simulation.weapon.reserve[weapon],
      .cooldown_ticks = player.simulation.weapon.cooldown_ticks,
      .reload_ticks = player.simulation.weapon.reload_ticks,
      .shot_index = player.simulation.weapon.shot_index,
      .recovery_ticks = player.simulation.weapon.recovery_ticks,
      .shot_sequence = player.simulation.weapon.shot_sequence,
      .punch_pitch = player.simulation.weapon.punch_pitch,
      .punch_yaw = player.simulation.weapon.punch_yaw,
    };
  }
  return packet;
}

Player* find_player(Server& server, std::uint8_t player_id) {
  if (player_id >= net::kMaxPlayers || !server.players[player_id].connected) return nullptr;
  return &server.players[player_id];
}

const Player* find_player(const Server& server, std::uint8_t player_id) {
  if (player_id >= net::kMaxPlayers || !server.players[player_id].connected) return nullptr;
  return &server.players[player_id];
}

}  // namespace cs::server
