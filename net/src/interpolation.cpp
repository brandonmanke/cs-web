#include "cs/interpolation.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace cs::net {
namespace {

float lerp(float first, float second, float amount) {
  return first + (second - first) * amount;
}

Vec3 lerp(Vec3 first, Vec3 second, float amount) {
  return {
    lerp(first.x, second.x, amount),
    lerp(first.y, second.y, amount),
    lerp(first.z, second.z, amount),
  };
}

float lerp_angle(float first, float second, float amount) {
  constexpr float pi = std::numbers::pi_v<float>;
  float delta = std::fmod(second - first + pi, 2.0F * pi);
  if (delta < 0.0F) delta += 2.0F * pi;
  delta -= pi;
  return first + delta * amount;
}

}  // namespace

void push_snapshot(InterpolationBuffer& buffer, const SnapshotPacket& snapshot) {
  for (std::uint32_t index = 0; index < snapshot.player_count; ++index) {
    const SnapshotPlayer& player = snapshot.players[index];
    if (player.id >= kMaxPlayers) continue;
    RemoteTrack& track = buffer.tracks[player.id];
    if (track.count > 0) {
      const RemoteSample& newest = track.samples[(track.count - 1U) % kInterpolationSamples];
      if (snapshot.server_tick <= newest.server_tick) continue;
    }
    track.samples[track.count % kInterpolationSamples] = {
      .server_tick = snapshot.server_tick,
      .player = player,
    };
    ++track.count;
  }
}

bool sample_player(
  const InterpolationBuffer& buffer,
  std::uint8_t player_id,
  float render_tick,
  SnapshotPlayer& player
) {
  if (player_id >= kMaxPlayers) return false;
  const RemoteTrack& track = buffer.tracks[player_id];
  if (track.count == 0) return false;
  const std::uint32_t first_sample = track.count > kInterpolationSamples ?
    track.count - kInterpolationSamples : 0U;
  const RemoteSample* before = nullptr;
  const RemoteSample* after = nullptr;
  for (std::uint32_t logical = first_sample; logical < track.count; ++logical) {
    const RemoteSample& sample = track.samples[logical % kInterpolationSamples];
    if (static_cast<float>(sample.server_tick) <= render_tick) before = &sample;
    if (static_cast<float>(sample.server_tick) >= render_tick) {
      after = &sample;
      break;
    }
  }
  if (before == nullptr) before = after;
  if (after == nullptr) after = before;
  if (before == nullptr || after == nullptr) return false;
  if (before == after || before->server_tick == after->server_tick) {
    player = before->player;
    return true;
  }

  const float amount = std::clamp(
    (render_tick - static_cast<float>(before->server_tick)) /
      static_cast<float>(after->server_tick - before->server_tick),
    0.0F,
    1.0F
  );
  player = amount < 0.5F ? before->player : after->player;
  player.origin = lerp(before->player.origin, after->player.origin, amount);
  player.velocity = lerp(before->player.velocity, after->player.velocity, amount);
  player.yaw = lerp_angle(before->player.yaw, after->player.yaw, amount);
  player.stamina = lerp(before->player.stamina, after->player.stamina, amount);
  return true;
}

}  // namespace cs::net
