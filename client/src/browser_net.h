#pragma once

#include "cs/net_protocol.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

namespace cs::client {

bool browser_online_requested();
bool browser_bots_requested();
void browser_net_start();
bool browser_net_connected();
void browser_net_game_status(
  std::uint8_t player_id,
  std::uint8_t player_count,
  std::uint32_t server_tick,
  std::uint32_t acknowledged_input,
  Vec3 authoritative_origin
);
bool browser_net_send(std::span<const std::uint8_t> bytes);
bool browser_net_receive(
  std::array<std::uint8_t, net::kMaxPacketBytes>& bytes,
  std::size_t& size
);
void browser_bot_game_status(
  std::uint8_t player_count,
  std::uint32_t server_tick,
  std::uint16_t kills,
  std::uint16_t deaths
);

}  // namespace cs::client
