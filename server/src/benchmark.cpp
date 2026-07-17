#include "cs/server.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>

int main() {
  cs::server::Server server{};
  cs::server::initialize(server);
  for (std::uint32_t index = 0; index < cs::net::kMaxPlayers; ++index) {
    if (cs::server::connect(server) < 0) return 1;
  }

  std::vector<double> samples;
  samples.reserve(4096);
  for (std::uint32_t tick = 0; tick < 4096; ++tick) {
    for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
      const cs::net::InputPacket input{
        .player_id = player,
        .command_count = 1,
        .newest_sequence = tick + 1U,
        .commands = {{
          {
            .sequence = tick + 1U,
            .view_tick = server.tick,
            .input = {
              .forward = (player & 1U) == 0U ? 1.0F : -1.0F,
              .strafe = (tick / 64U & 1U) == 0U ? 0.35F : -0.35F,
              .yaw = static_cast<float>(player) * 0.785398F,
            },
          },
        }},
      };
      cs::server::receive_input(server, input);
    }
    const auto start = std::chrono::steady_clock::now();
    cs::server::step(server);
    for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
      (void)cs::server::snapshot(server, player);
    }
    const auto end = std::chrono::steady_clock::now();
    samples.push_back(std::chrono::duration<double, std::milli>(end - start).count());
  }

  std::sort(samples.begin(), samples.end());
  const double p95 = samples[(samples.size() * 95U) / 100U];
  std::printf("8-player authoritative server: %.3f ms p95 (budget 2.000 ms)\n", p95);
  return p95 <= 2.0 ? 0 : 1;
}
