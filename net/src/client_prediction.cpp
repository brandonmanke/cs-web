#include "cs/client_prediction.h"

#include <cmath>

namespace cs::net {
namespace {

void apply_authoritative(
  Prediction& prediction,
  const SnapshotPlayer& authoritative,
  std::uint32_t server_tick
) {
  Simulation& simulation = prediction.simulation;
  set_player(simulation, authoritative.origin, authoritative.velocity);
  simulation.player.yaw = authoritative.yaw;
  simulation.player.stamina = authoritative.stamina;
  simulation.player.on_ground = (authoritative.flags & SnapshotOnGround) != 0U;
  simulation.player.ducked = (authoritative.flags & SnapshotDucked) != 0U;
  simulation.player.jump_held = (authoritative.flags & SnapshotJumpHeld) != 0U;
  simulation.tick = server_tick;

  if (authoritative.weapon > WeaponNone && authoritative.weapon < kWeaponCount) {
    const auto weapon = static_cast<WeaponId>(authoritative.weapon);
    simulation.weapon.selected = weapon;
    simulation.weapon.magazine[weapon] = authoritative.magazine;
    simulation.weapon.reserve[weapon] = authoritative.reserve;
  }
  simulation.weapon.cooldown_ticks = 0;
  simulation.weapon.reload_ticks = 0;
  simulation.weapon.shot_index = 0;
  simulation.weapon.recovery_ticks = 0;
  simulation.weapon.punch_pitch = 0.0F;
  simulation.weapon.punch_yaw = 0.0F;
  simulation.weapon.fire_held = false;
  clear_targets(simulation);
  select_weapon(simulation, simulation.weapon.selected, true);
}

float distance(Vec3 first, Vec3 second) {
  const float x = first.x - second.x;
  const float y = first.y - second.y;
  const float z = first.z - second.z;
  return std::sqrt(x * x + y * y + z * z);
}

}  // namespace

const SnapshotPlayer* find_player(const SnapshotPacket& snapshot, std::uint8_t player_id) {
  for (std::uint32_t index = 0; index < snapshot.player_count; ++index) {
    if (snapshot.players[index].id == player_id) return &snapshot.players[index];
  }
  return nullptr;
}

void initialize_prediction(
  Prediction& prediction,
  std::uint8_t player_id,
  const SnapshotPlayer& authoritative,
  std::uint32_t server_tick
) {
  prediction = {};
  prediction.player_id = player_id;
  cs::initialize(prediction.simulation);
  apply_authoritative(prediction, authoritative, server_tick);
}

Command predict(Prediction& prediction, const InputCommand& input, std::uint32_t view_tick) {
  const Command command{
    .sequence = prediction.next_sequence++,
    .view_tick = view_tick,
    .input = input,
  };
  prediction.history[command.sequence % kPredictionHistory] = {
    .valid = true,
    .command = command,
  };
  cs::step(prediction.simulation, input);
  return command;
}

InputPacket input_packet(const Prediction& prediction) {
  InputPacket packet{
    .player_id = prediction.player_id,
    .newest_sequence = prediction.next_sequence - 1U,
    .ack_snapshot = prediction.last_snapshot_sequence,
  };
  const std::uint32_t first = packet.newest_sequence >= kInputRedundancy ?
    packet.newest_sequence - kInputRedundancy + 1U : 1U;
  for (std::uint32_t sequence = first; sequence <= packet.newest_sequence; ++sequence) {
    const PredictionEntry& entry = prediction.history[sequence % kPredictionHistory];
    if (!entry.valid || entry.command.sequence != sequence) continue;
    packet.commands[packet.command_count++] = entry.command;
  }
  return packet;
}

float reconcile(Prediction& prediction, const SnapshotPacket& snapshot) {
  if (
    snapshot.recipient_id != prediction.player_id ||
    snapshot.sequence <= prediction.last_snapshot_sequence
  ) {
    return 0.0F;
  }
  const SnapshotPlayer* authoritative = find_player(snapshot, prediction.player_id);
  if (authoritative == nullptr) return 0.0F;

  const Vec3 before = prediction.simulation.player.origin;
  prediction.last_snapshot_sequence = snapshot.sequence;
  prediction.last_ack_input = snapshot.ack_input;
  apply_authoritative(prediction, *authoritative, snapshot.server_tick);

  for (
    std::uint32_t sequence = snapshot.ack_input + 1U;
    sequence < prediction.next_sequence;
    ++sequence
  ) {
    PredictionEntry& entry = prediction.history[sequence % kPredictionHistory];
    if (!entry.valid || entry.command.sequence != sequence) continue;
    cs::step(prediction.simulation, entry.command.input);
  }

  for (PredictionEntry& entry : prediction.history) {
    if (entry.valid && entry.command.sequence <= snapshot.ack_input) entry = {};
  }
  return distance(before, prediction.simulation.player.origin);
}

}  // namespace cs::net
