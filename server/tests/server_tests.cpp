#include "cs/client_prediction.h"
#include "cs/interpolation.h"
#include "cs/server.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

namespace {

int failures = 0;

void check(bool condition, const char* message) {
  if (condition) return;
  std::fprintf(stderr, "FAIL: %s\n", message);
  ++failures;
}

float distance(cs::Vec3 first, cs::Vec3 second) {
  const float x = first.x - second.x;
  const float y = first.y - second.y;
  const float z = first.z - second.z;
  return std::sqrt(x * x + y * y + z * z);
}

void make_flat(cs::Simulation& simulation, cs::Vec3 origin) {
  cs::clear_targets(simulation);
  cs::clear_world(simulation);
  cs::add_solid(
    simulation,
    {-4096.0F, -16.0F, -4096.0F},
    {4096.0F, 0.0F, 4096.0F}
  );
  cs::set_player(simulation, origin);
  cs::select_weapon(simulation, cs::WeaponAk47, true);
}

void test_protocol_round_trip() {
  const cs::net::InputPacket input{
    .player_id = 2,
    .command_count = 2,
    .newest_sequence = 19,
    .ack_snapshot = 7,
    .commands = {{
      {.sequence = 18, .view_tick = 80, .input = {.forward = 0.5F, .yaw = 1.1F}},
      {.sequence = 19, .view_tick = 81, .input = {.strafe = -0.25F, .buttons = cs::ButtonJump}},
    }},
  };
  std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
  std::size_t written = 0;
  check(cs::net::encode_input(input, bytes, written), "input packet encodes");
  check(written == 48, "two-command input packet stays 48 bytes");
  cs::net::InputPacket decoded{};
  check(
    cs::net::decode_input(std::span(bytes.data(), written), decoded),
    "input packet decodes"
  );
  check(decoded.player_id == 2 && decoded.command_count == 2, "input identity round-trips");
  check(decoded.commands[1].sequence == 19, "input sequence round-trips");
  check(std::fabs(decoded.commands[0].input.forward - 0.5F) < 0.01F, "input axis quantization is bounded");
  check(
    !cs::net::decode_input(std::span(bytes.data(), written - 1U), decoded),
    "truncated input packet is rejected"
  );
  bytes[2] = 99;
  check(
    !cs::net::decode_input(std::span(bytes.data(), written), decoded),
    "unknown protocol version is rejected"
  );

  cs::net::SnapshotPacket snapshot{
    .sequence = 4,
    .server_tick = 300,
    .ack_input = 19,
    .recipient_id = 2,
    .player_count = 1,
    .players = {{
      {
        .id = 2,
        .flags = cs::net::SnapshotActive | cs::net::SnapshotAlive,
        .health = 93,
        .kills = 2,
        .deaths = 1,
        .origin = {123.375F, 36.0F, -72.125F},
        .velocity = {250.0F, 0.0F, -30.0F},
        .yaw = -2.0F,
        .weapon = cs::WeaponAk47,
        .magazine = 23,
        .reserve = 90,
      },
    }},
  };
  check(cs::net::encode_snapshot(snapshot, bytes, written), "snapshot packet encodes");
  check(written == 45, "single-player snapshot stays 45 bytes");
  cs::net::SnapshotPacket decoded_snapshot{};
  check(
    cs::net::decode_snapshot(std::span(bytes.data(), written), decoded_snapshot),
    "snapshot packet decodes"
  );
  check(decoded_snapshot.players[0].health == 93, "snapshot state round-trips");
  check(
    distance(decoded_snapshot.players[0].origin, snapshot.players[0].origin) < 0.01F,
    "snapshot position has eighth-unit precision"
  );
}

void test_server_authority_and_lag_compensation() {
  cs::server::Server server{};
  cs::server::initialize(server);
  for (std::uint32_t index = 0; index < cs::net::kMaxPlayers; ++index) {
    check(cs::server::connect(server) == static_cast<int>(index), "server assigns stable player IDs");
  }
  check(cs::server::connect(server) < 0, "server enforces the eight-player cap");

  cs::server::Player& shooter = server.players[0];
  cs::server::Player& victim = server.players[1];
  make_flat(shooter.simulation, {0.0F, cs::kStandingHalfHeight, 200.0F});
  make_flat(victim.simulation, {0.0F, cs::kStandingHalfHeight, 0.0F});
  cs::server::step(server);
  const std::uint32_t historical_tick = server.tick;
  cs::set_player(victim.simulation, {200.0F, cs::kStandingHalfHeight, 0.0F});

  const cs::net::InputPacket fire{
    .player_id = 0,
    .command_count = 1,
    .newest_sequence = 1,
    .commands = {{
      {
        .sequence = 1,
        .view_tick = historical_tick,
        .input = {.yaw = 0.0F, .pitch = 0.0F, .buttons = cs::ButtonFire},
      },
    }},
  };
  check(cs::server::receive_input(server, fire), "server accepts valid player input");
  cs::server::step(server);
  check(!victim.alive && victim.health == 0, "server rewinds a player hitbox for a headshot");
  check(shooter.kills == 1 && victim.deaths == 1, "server owns FFA score and death state");

  const cs::net::InputPacket release{
    .player_id = 0,
    .command_count = 1,
    .newest_sequence = 2,
    .commands = {{{.sequence = 2, .view_tick = server.tick}}},
  };
  cs::server::receive_input(server, release);
  for (std::uint32_t tick = 0; tick < cs::server::kRespawnTicks; ++tick) {
    cs::server::step(server);
  }
  check(victim.alive && victim.health == 100, "deathmatch player respawns after two seconds");

  const cs::net::SnapshotPacket state = cs::server::snapshot(server, 0);
  check(state.player_count == cs::net::kMaxPlayers, "snapshot contains all connected players");
  std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
  std::size_t written = 0;
  check(cs::net::encode_snapshot(state, bytes, written), "eight-player snapshot encodes");
  check(written <= cs::net::kMaxPacketBytes, "eight-player snapshot fits packet budget");
}

void test_remote_interpolation() {
  cs::net::InterpolationBuffer buffer{};
  cs::net::SnapshotPacket first{
    .sequence = 1,
    .server_tick = 100,
    .recipient_id = 0,
    .player_count = 1,
    .players = {{{
      .id = 1,
      .flags = cs::net::SnapshotActive | cs::net::SnapshotAlive,
      .health = 100,
      .origin = {0.0F, 36.0F, 0.0F},
      .yaw = 3.1F,
      .weapon = cs::WeaponAk47,
    }}},
  };
  cs::net::SnapshotPacket second = first;
  second.sequence = 2;
  second.server_tick = 110;
  second.players[0].origin.x = 100.0F;
  second.players[0].yaw = -3.1F;
  cs::net::push_snapshot(buffer, first);
  cs::net::push_snapshot(buffer, second);
  cs::net::SnapshotPlayer sampled{};
  check(cs::net::sample_player(buffer, 1, 105.0F, sampled), "remote player samples from snapshot buffer");
  check(std::fabs(sampled.origin.x - 50.0F) < 0.01F, "remote position interpolates at render time");
  check(std::fabs(sampled.yaw) > 3.0F, "remote yaw takes the short path across pi");
}

struct PendingInput {
  std::uint32_t delivery_tick = 0;
  cs::net::InputPacket packet{};
};

struct PendingSnapshot {
  std::uint32_t delivery_tick = 0;
  std::uint8_t client = 0;
  cs::net::SnapshotPacket packet{};
};

void test_lossy_loopback() {
  constexpr std::uint32_t one_way_ticks = 5;
  constexpr std::uint32_t active_ticks = 768;
  constexpr std::uint32_t settle_ticks = 96;
  cs::server::Server server{};
  cs::server::initialize(server);
  std::array<cs::net::Prediction, cs::net::kMaxPlayers> clients{};
  for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
    cs::server::connect(server);
    const cs::net::SnapshotPacket initial = cs::server::snapshot(server, player);
    cs::net::initialize_prediction(
      clients[player],
      player,
      *cs::net::find_player(initial, player),
      initial.server_tick
    );
  }

  std::mt19937 random(0xC516U);
  std::uniform_real_distribution<float> chance(0.0F, 1.0F);
  std::vector<PendingInput> inputs;
  std::vector<PendingSnapshot> snapshots;
  float largest_correction = 0.0F;
  std::size_t largest_input_packet = 0;
  std::size_t largest_snapshot_packet = 0;

  for (std::uint32_t tick = 0; tick < active_ticks + settle_ticks; ++tick) {
    for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
      cs::InputCommand input{};
      if (tick < active_ticks) {
        input.forward = ((tick / 96U + player) & 1U) == 0U ? 0.8F : -0.8F;
        input.strafe = (tick / 48U & 1U) == 0U ? 0.3F : -0.3F;
        input.yaw = static_cast<float>(player) * 0.785398F;
      }
      cs::net::predict(clients[player], input, server.tick);
      cs::net::InputPacket packet = cs::net::input_packet(clients[player]);
      std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
      std::size_t written = 0;
      check(cs::net::encode_input(packet, bytes, written), "loopback input encodes");
      largest_input_packet = std::max(largest_input_packet, written);
      cs::net::InputPacket decoded{};
      check(
        cs::net::decode_input(std::span(bytes.data(), written), decoded),
        "loopback input decodes"
      );
      if (chance(random) >= 0.05F) inputs.push_back({tick + one_way_ticks, decoded});
    }

    for (const PendingInput& pending : inputs) {
      if (pending.delivery_tick == tick) cs::server::receive_input(server, pending.packet);
    }
    std::erase_if(inputs, [tick](const PendingInput& pending) {
      return pending.delivery_tick <= tick;
    });

    cs::server::step(server);
    if (tick % 3U == 0U) {
      for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
        cs::net::SnapshotPacket packet = cs::server::snapshot(server, player);
        std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
        std::size_t written = 0;
        check(cs::net::encode_snapshot(packet, bytes, written), "loopback snapshot encodes");
        largest_snapshot_packet = std::max(largest_snapshot_packet, written);
        cs::net::SnapshotPacket decoded{};
        check(
          cs::net::decode_snapshot(std::span(bytes.data(), written), decoded),
          "loopback snapshot decodes"
        );
        if (chance(random) >= 0.05F) {
          snapshots.push_back({tick + one_way_ticks, player, decoded});
        }
      }
    }

    for (const PendingSnapshot& pending : snapshots) {
      if (pending.delivery_tick != tick) continue;
      largest_correction = std::max(
        largest_correction,
        cs::net::reconcile(clients[pending.client], pending.packet)
      );
    }
    std::erase_if(snapshots, [tick](const PendingSnapshot& pending) {
      return pending.delivery_tick <= tick;
    });
  }

  float largest_final_error = 0.0F;
  for (std::uint8_t player = 0; player < cs::net::kMaxPlayers; ++player) {
    const cs::server::Player* authoritative = cs::server::find_player(server, player);
    largest_final_error = std::max(
      largest_final_error,
      distance(clients[player].simulation.player.origin, authoritative->simulation.player.origin)
    );
  }
  check(largest_input_packet <= 64, "redundant input packets stay under 64 bytes");
  check(largest_snapshot_packet <= cs::net::kMaxPacketBytes, "full snapshots stay under 512 bytes");
  check(largest_correction < 96.0F, "150 ms RTT and five-percent loss avoid gross prediction warps");
  check(largest_final_error < 8.0F, "predicted players converge after the lossy run settles");
  std::printf(
    "loopback: input=%zu B snapshot=%zu B max-correction=%.2f u final-error=%.2f u\n",
    largest_input_packet,
    largest_snapshot_packet,
    largest_correction,
    largest_final_error
  );
}

}  // namespace

int main() {
  test_protocol_round_trip();
  test_server_authority_and_lag_compensation();
  test_remote_interpolation();
  test_lossy_loopback();
  if (failures == 0) std::puts("server/net tests passed");
  return failures == 0 ? 0 : 1;
}
