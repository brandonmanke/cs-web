#pragma once

#include "cs/net_protocol.h"

#include <array>
#include <cstdint>

namespace cs::net {

inline constexpr std::uint32_t kPredictionHistory = 256;

struct PredictionEntry {
  bool valid = false;
  Command command{};
};

struct Prediction {
  std::uint8_t player_id = 0;
  std::uint32_t next_sequence = 1;
  std::uint32_t last_ack_input = 0;
  std::uint32_t last_snapshot_sequence = 0;
  std::array<PredictionEntry, kPredictionHistory> history{};
  Simulation simulation{};
};

const SnapshotPlayer* find_player(const SnapshotPacket& snapshot, std::uint8_t player_id);
void initialize_prediction(
  Prediction& prediction,
  std::uint8_t player_id,
  const SnapshotPlayer& authoritative,
  std::uint32_t server_tick
);
Command predict(Prediction& prediction, const InputCommand& input, std::uint32_t view_tick);
Command queue_input(Prediction& prediction, const InputCommand& input, std::uint32_t view_tick);
InputPacket input_packet(const Prediction& prediction);
float reconcile(Prediction& prediction, const SnapshotPacket& snapshot);

}  // namespace cs::net
