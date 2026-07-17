#pragma once

#include "cs/net_protocol.h"

#include <array>
#include <cstdint>

namespace cs::server {

inline constexpr std::uint32_t kCommandHistory = 256;
inline constexpr std::uint32_t kPositionHistory = 256;
inline constexpr std::uint32_t kRespawnTicks = 128;
inline constexpr std::uint32_t kMaxLagCompensationTicks = 13;
inline constexpr std::uint8_t kNoPlayer = 0xFFU;

struct BotState {
  std::uint8_t target_id = kNoPlayer;
  std::uint32_t reaction_ticks = 0;
};

struct QueuedCommand {
  bool valid = false;
  net::Command command{};
};

struct Player {
  std::uint8_t id = 0;
  bool connected = false;
  bool bot = false;
  bool alive = false;
  std::uint16_t health = 0;
  std::uint16_t kills = 0;
  std::uint16_t deaths = 0;
  std::uint32_t respawn_ticks = 0;
  std::uint32_t next_input_sequence = 1;
  std::uint32_t highest_received_sequence = 0;
  std::uint32_t last_processed_sequence = 0;
  net::Command last_command{};
  std::array<QueuedCommand, kCommandHistory> input_queue{};
  std::array<std::uint8_t, net::kMaxPlayers> target_player_ids{};
  std::uint32_t target_player_count = 0;
  BotState bot_state{};
  Simulation simulation{};
};

struct HistoryPlayer {
  Vec3 origin{};
  bool alive = false;
  bool ducked = false;
};

struct HistoryFrame {
  std::uint32_t tick = 0;
  bool valid = false;
  std::array<HistoryPlayer, net::kMaxPlayers> players{};
};

struct Server {
  std::uint32_t tick = 0;
  std::uint32_t snapshot_sequence = 0;
  std::array<Player, net::kMaxPlayers> players{};
  std::array<HistoryFrame, kPositionHistory> history{};
};

void initialize(Server& server);
int connect(Server& server);
int connect_bot(Server& server);
void disconnect(Server& server, std::uint8_t player_id);
bool receive_input(Server& server, const net::InputPacket& packet);
void step(Server& server);
net::SnapshotPacket snapshot(Server& server, std::uint8_t recipient_id);
Player* find_player(Server& server, std::uint8_t player_id);
const Player* find_player(const Server& server, std::uint8_t player_id);

}  // namespace cs::server
