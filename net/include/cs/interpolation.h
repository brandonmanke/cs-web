#pragma once

#include "cs/net_protocol.h"

#include <array>
#include <cstdint>

namespace cs::net {

inline constexpr std::uint32_t kInterpolationSamples = 32;

struct RemoteSample {
  std::uint32_t server_tick = 0;
  SnapshotPlayer player{};
};

struct RemoteTrack {
  std::array<RemoteSample, kInterpolationSamples> samples{};
  std::uint32_t count = 0;
};

struct InterpolationBuffer {
  std::array<RemoteTrack, kMaxPlayers> tracks{};
};

void push_snapshot(InterpolationBuffer& buffer, const SnapshotPacket& snapshot);
bool sample_player(
  const InterpolationBuffer& buffer,
  std::uint8_t player_id,
  float render_tick,
  SnapshotPlayer& player
);

}  // namespace cs::net
