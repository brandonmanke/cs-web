#pragma once

#include "cs/sim.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

namespace cs::net {

inline constexpr std::uint8_t kProtocolVersion = 1;
inline constexpr std::uint32_t kMaxPlayers = 8;
inline constexpr std::uint32_t kInputRedundancy = 3;
inline constexpr std::size_t kMaxPacketBytes = 512;

enum class PacketKind : std::uint8_t {
  Input = 1,
  Snapshot = 2,
};

enum SnapshotPlayerFlag : std::uint8_t {
  SnapshotActive = 1U << 0U,
  SnapshotAlive = 1U << 1U,
  SnapshotOnGround = 1U << 2U,
  SnapshotDucked = 1U << 3U,
  SnapshotJumpHeld = 1U << 4U,
};

struct Command {
  std::uint32_t sequence = 0;
  std::uint32_t view_tick = 0;
  InputCommand input{};
};

struct InputPacket {
  std::uint8_t player_id = 0;
  std::uint8_t command_count = 0;
  std::uint32_t newest_sequence = 0;
  std::uint32_t ack_snapshot = 0;
  std::array<Command, kInputRedundancy> commands{};
};

struct SnapshotPlayer {
  std::uint8_t id = 0;
  std::uint8_t flags = 0;
  std::uint16_t health = 0;
  std::uint16_t kills = 0;
  std::uint16_t deaths = 0;
  Vec3 origin{};
  Vec3 velocity{};
  float yaw = 0.0F;
  float stamina = 0.0F;
  std::uint32_t weapon = WeaponNone;
  std::uint32_t magazine = 0;
  std::uint32_t reserve = 0;
};

struct SnapshotPacket {
  std::uint32_t sequence = 0;
  std::uint32_t server_tick = 0;
  std::uint32_t ack_input = 0;
  std::uint8_t recipient_id = 0;
  std::uint8_t player_count = 0;
  std::array<SnapshotPlayer, kMaxPlayers> players{};
};

bool encode_input(
  const InputPacket& packet,
  std::span<std::uint8_t> destination,
  std::size_t& written
);
bool decode_input(std::span<const std::uint8_t> bytes, InputPacket& packet);
bool encode_snapshot(
  const SnapshotPacket& packet,
  std::span<std::uint8_t> destination,
  std::size_t& written
);
bool decode_snapshot(std::span<const std::uint8_t> bytes, SnapshotPacket& packet);

}  // namespace cs::net
