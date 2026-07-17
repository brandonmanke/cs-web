#include "cs/server.h"

#include <algorithm>
#include <cmath>

namespace cs::server {
namespace {

Vec3 spawn_for(std::uint8_t player_id) {
  const auto spawns = aim_arena_spawns();
  const Vec3 base = spawns[player_id % spawns.size()];
  const float lane = static_cast<float>(player_id / 2U) - 1.5F;
  return {base.x + lane * 48.0F, base.y, base.z};
}

void reset_simulation(Player& player) {
  cs::initialize(player.simulation);
  clear_targets(player.simulation);
  set_player(player.simulation, spawn_for(player.id));
  player.health = 100;
  player.alive = true;
  player.respawn_ticks = 0;
  player.last_command = {};
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

void disconnect(Server& server, std::uint8_t player_id) {
  if (player_id >= net::kMaxPlayers) return;
  Player& player = server.players[player_id];
  player = {};
  player.id = player_id;
  record_history(server);
}

bool receive_input(Server& server, const net::InputPacket& packet) {
  Player* player = find_player(server, packet.player_id);
  if (player == nullptr || packet.command_count == 0 || packet.command_count > net::kInputRedundancy) {
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
      (command.input.buttons & ~0x0FU) != 0U
    ) {
      return false;
    }
    previous_sequence = command.sequence;
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
  return previous_sequence == packet.newest_sequence;
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
    const InputCommand input = command_for_tick(player, view_tick);
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
