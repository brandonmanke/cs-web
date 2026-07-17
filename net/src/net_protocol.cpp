#include "cs/net_protocol.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace cs::net {
namespace {

class Writer {
 public:
  explicit Writer(std::span<std::uint8_t> bytes) : bytes_(bytes) {}

  bool byte(std::uint8_t value) {
    if (offset_ >= bytes_.size()) return false;
    bytes_[offset_++] = value;
    return true;
  }

  bool word(std::uint16_t value) {
    return byte(static_cast<std::uint8_t>(value)) &&
      byte(static_cast<std::uint8_t>(value >> 8U));
  }

  bool dword(std::uint32_t value) {
    return word(static_cast<std::uint16_t>(value)) &&
      word(static_cast<std::uint16_t>(value >> 16U));
  }

  std::size_t size() const { return offset_; }

 private:
  std::span<std::uint8_t> bytes_;
  std::size_t offset_ = 0;
};

class Reader {
 public:
  explicit Reader(std::span<const std::uint8_t> bytes) : bytes_(bytes) {}

  bool byte(std::uint8_t& value) {
    if (offset_ >= bytes_.size()) return false;
    value = bytes_[offset_++];
    return true;
  }

  bool word(std::uint16_t& value) {
    std::uint8_t low = 0;
    std::uint8_t high = 0;
    if (!byte(low) || !byte(high)) return false;
    value = static_cast<std::uint16_t>(
      static_cast<std::uint16_t>(low) |
      static_cast<std::uint16_t>(high) << 8U
    );
    return true;
  }

  bool dword(std::uint32_t& value) {
    std::uint16_t low = 0;
    std::uint16_t high = 0;
    if (!word(low) || !word(high)) return false;
    value = static_cast<std::uint32_t>(low) |
      static_cast<std::uint32_t>(high) << 16U;
    return true;
  }

  bool finished() const { return offset_ == bytes_.size(); }

 private:
  std::span<const std::uint8_t> bytes_;
  std::size_t offset_ = 0;
};

std::uint8_t quantize_unit(float value) {
  const auto signed_value = static_cast<std::int8_t>(std::lround(
    std::clamp(value, -1.0F, 1.0F) * 127.0F
  ));
  return static_cast<std::uint8_t>(signed_value);
}

float dequantize_unit(std::uint8_t value) {
  return static_cast<float>(static_cast<std::int8_t>(value)) / 127.0F;
}

std::uint16_t quantize_angle(float angle) {
  constexpr float pi = std::numbers::pi_v<float>;
  float wrapped = std::fmod(angle + pi, 2.0F * pi);
  if (wrapped < 0.0F) wrapped += 2.0F * pi;
  wrapped -= pi;
  const auto signed_value = static_cast<std::int16_t>(std::lround(
    std::clamp(wrapped / pi, -1.0F, 1.0F) * 32767.0F
  ));
  return static_cast<std::uint16_t>(signed_value);
}

float dequantize_angle(std::uint16_t value) {
  constexpr float pi = std::numbers::pi_v<float>;
  return static_cast<float>(static_cast<std::int16_t>(value)) *
    (pi / 32767.0F);
}

std::uint16_t quantize_scalar(float value, float scale) {
  const auto signed_value = static_cast<std::int16_t>(std::lround(
    std::clamp(
      value * scale,
      static_cast<float>(-32768),
      static_cast<float>(32767)
    )
  ));
  return static_cast<std::uint16_t>(signed_value);
}

float dequantize_scalar(std::uint16_t value, float scale) {
  return static_cast<float>(static_cast<std::int16_t>(value)) / scale;
}

bool write_header(Writer& writer, PacketKind kind) {
  return writer.byte('C') &&
    writer.byte('S') &&
    writer.byte(kProtocolVersion) &&
    writer.byte(static_cast<std::uint8_t>(kind));
}

bool read_header(Reader& reader, PacketKind expected) {
  std::uint8_t first = 0;
  std::uint8_t second = 0;
  std::uint8_t version = 0;
  std::uint8_t kind = 0;
  return reader.byte(first) &&
    reader.byte(second) &&
    reader.byte(version) &&
    reader.byte(kind) &&
    first == 'C' &&
    second == 'S' &&
    version == kProtocolVersion &&
    kind == static_cast<std::uint8_t>(expected);
}

bool write_command(Writer& writer, const Command& command) {
  if (
    command.sequence == 0 ||
    command.input.requested_weapon >= kWeaponCount ||
    (command.input.buttons & ~0x0FU) != 0U
  ) {
    return false;
  }
  return writer.dword(command.sequence) &&
    writer.dword(command.view_tick) &&
    writer.byte(quantize_unit(command.input.forward)) &&
    writer.byte(quantize_unit(command.input.strafe)) &&
    writer.word(quantize_angle(command.input.yaw)) &&
    writer.word(quantize_angle(command.input.pitch)) &&
    writer.byte(static_cast<std::uint8_t>(command.input.buttons)) &&
    writer.byte(static_cast<std::uint8_t>(command.input.requested_weapon));
}

bool read_command(Reader& reader, Command& command) {
  std::uint8_t forward = 0;
  std::uint8_t strafe = 0;
  std::uint16_t yaw = 0;
  std::uint16_t pitch = 0;
  std::uint8_t buttons = 0;
  std::uint8_t weapon = 0;
  if (
    !reader.dword(command.sequence) ||
    !reader.dword(command.view_tick) ||
    !reader.byte(forward) ||
    !reader.byte(strafe) ||
    !reader.word(yaw) ||
    !reader.word(pitch) ||
    !reader.byte(buttons) ||
    !reader.byte(weapon)
  ) {
    return false;
  }
  if (weapon >= kWeaponCount || (buttons & ~0x0FU) != 0U) return false;
  command.input = {
    .forward = dequantize_unit(forward),
    .strafe = dequantize_unit(strafe),
    .yaw = dequantize_angle(yaw),
    .pitch = dequantize_angle(pitch),
    .buttons = buttons,
    .requested_weapon = weapon,
  };
  return command.sequence != 0;
}

bool valid_input_packet(const InputPacket& packet) {
  if (
    packet.player_id >= kMaxPlayers ||
    packet.command_count == 0 ||
    packet.command_count > kInputRedundancy ||
    packet.newest_sequence == 0
  ) {
    return false;
  }
  std::uint32_t previous = 0;
  for (std::uint32_t index = 0; index < packet.command_count; ++index) {
    const Command& command = packet.commands[index];
    if (
      command.sequence <= previous ||
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
    previous = command.sequence;
  }
  return previous == packet.newest_sequence;
}

bool write_player(Writer& writer, const SnapshotPlayer& player) {
  if (
    player.id >= kMaxPlayers ||
    player.weapon >= kWeaponCount ||
    (player.flags & ~0x1FU) != 0U ||
    player.health > 255 ||
    player.magazine > 255 ||
    player.reserve > 65535 ||
    !std::isfinite(player.origin.x) ||
    !std::isfinite(player.origin.y) ||
    !std::isfinite(player.origin.z) ||
    !std::isfinite(player.velocity.x) ||
    !std::isfinite(player.velocity.y) ||
    !std::isfinite(player.velocity.z) ||
    !std::isfinite(player.yaw) ||
    !std::isfinite(player.stamina)
  ) {
    return false;
  }
  return writer.byte(player.id) &&
    writer.byte(player.flags) &&
    writer.byte(static_cast<std::uint8_t>(std::min<std::uint16_t>(player.health, 255))) &&
    writer.byte(static_cast<std::uint8_t>(player.weapon)) &&
    writer.word(player.kills) &&
    writer.word(player.deaths) &&
    writer.word(quantize_scalar(player.origin.x, 8.0F)) &&
    writer.word(quantize_scalar(player.origin.y, 8.0F)) &&
    writer.word(quantize_scalar(player.origin.z, 8.0F)) &&
    writer.word(quantize_scalar(player.velocity.x, 8.0F)) &&
    writer.word(quantize_scalar(player.velocity.y, 8.0F)) &&
    writer.word(quantize_scalar(player.velocity.z, 8.0F)) &&
    writer.word(quantize_angle(player.yaw)) &&
    writer.word(static_cast<std::uint16_t>(std::lround(
      std::clamp(player.stamina, 0.0F, 4095.0F) * 16.0F
    ))) &&
    writer.byte(static_cast<std::uint8_t>(player.magazine)) &&
    writer.word(static_cast<std::uint16_t>(player.reserve));
}

bool read_player(Reader& reader, SnapshotPlayer& player) {
  std::uint8_t health = 0;
  std::uint8_t weapon = 0;
  std::uint8_t magazine = 0;
  std::uint16_t origin_x = 0;
  std::uint16_t origin_y = 0;
  std::uint16_t origin_z = 0;
  std::uint16_t velocity_x = 0;
  std::uint16_t velocity_y = 0;
  std::uint16_t velocity_z = 0;
  std::uint16_t yaw = 0;
  std::uint16_t stamina = 0;
  std::uint16_t reserve = 0;
  if (
    !reader.byte(player.id) ||
    !reader.byte(player.flags) ||
    !reader.byte(health) ||
    !reader.byte(weapon) ||
    !reader.word(player.kills) ||
    !reader.word(player.deaths) ||
    !reader.word(origin_x) ||
    !reader.word(origin_y) ||
    !reader.word(origin_z) ||
    !reader.word(velocity_x) ||
    !reader.word(velocity_y) ||
    !reader.word(velocity_z) ||
    !reader.word(yaw) ||
    !reader.word(stamina) ||
    !reader.byte(magazine) ||
    !reader.word(reserve)
  ) {
    return false;
  }
  if (
    player.id >= kMaxPlayers ||
    weapon >= kWeaponCount ||
    (player.flags & ~0x1FU) != 0U
  ) {
    return false;
  }
  player.health = health;
  player.weapon = weapon;
  player.origin = {
    dequantize_scalar(origin_x, 8.0F),
    dequantize_scalar(origin_y, 8.0F),
    dequantize_scalar(origin_z, 8.0F),
  };
  player.velocity = {
    dequantize_scalar(velocity_x, 8.0F),
    dequantize_scalar(velocity_y, 8.0F),
    dequantize_scalar(velocity_z, 8.0F),
  };
  player.yaw = dequantize_angle(yaw);
  player.stamina = static_cast<float>(stamina) / 16.0F;
  player.magazine = magazine;
  player.reserve = reserve;
  return true;
}

}  // namespace

bool encode_input(
  const InputPacket& packet,
  std::span<std::uint8_t> destination,
  std::size_t& written
) {
  written = 0;
  if (!valid_input_packet(packet)) return false;
  Writer writer(destination);
  if (
    !write_header(writer, PacketKind::Input) ||
    !writer.byte(packet.player_id) ||
    !writer.byte(packet.command_count) ||
    !writer.word(0) ||
    !writer.dword(packet.newest_sequence) ||
    !writer.dword(packet.ack_snapshot)
  ) {
    return false;
  }
  for (std::uint32_t index = 0; index < packet.command_count; ++index) {
    if (!write_command(writer, packet.commands[index])) return false;
  }
  written = writer.size();
  return true;
}

bool decode_input(std::span<const std::uint8_t> bytes, InputPacket& packet) {
  packet = {};
  Reader reader(bytes);
  std::uint16_t reserved = 0;
  if (
    !read_header(reader, PacketKind::Input) ||
    !reader.byte(packet.player_id) ||
    !reader.byte(packet.command_count) ||
    !reader.word(reserved) ||
    !reader.dword(packet.newest_sequence) ||
    !reader.dword(packet.ack_snapshot)
  ) {
    return false;
  }
  if (
    reserved != 0 ||
    packet.player_id >= kMaxPlayers ||
    packet.command_count == 0 ||
    packet.command_count > kInputRedundancy
  ) {
    return false;
  }
  for (std::uint32_t index = 0; index < packet.command_count; ++index) {
    if (!read_command(reader, packet.commands[index])) return false;
  }
  return reader.finished() && valid_input_packet(packet);
}

bool encode_snapshot(
  const SnapshotPacket& packet,
  std::span<std::uint8_t> destination,
  std::size_t& written
) {
  written = 0;
  if (
    packet.sequence == 0 ||
    packet.recipient_id >= kMaxPlayers ||
    packet.player_count > kMaxPlayers
  ) {
    return false;
  }
  Writer writer(destination);
  if (
    !write_header(writer, PacketKind::Snapshot) ||
    !writer.dword(packet.sequence) ||
    !writer.dword(packet.server_tick) ||
    !writer.dword(packet.ack_input) ||
    !writer.byte(packet.recipient_id) ||
    !writer.byte(packet.player_count)
  ) {
    return false;
  }
  for (std::uint32_t index = 0; index < packet.player_count; ++index) {
    if (!write_player(writer, packet.players[index])) return false;
  }
  written = writer.size();
  return true;
}

bool decode_snapshot(std::span<const std::uint8_t> bytes, SnapshotPacket& packet) {
  packet = {};
  Reader reader(bytes);
  if (
    !read_header(reader, PacketKind::Snapshot) ||
    !reader.dword(packet.sequence) ||
    !reader.dword(packet.server_tick) ||
    !reader.dword(packet.ack_input) ||
    !reader.byte(packet.recipient_id) ||
    !reader.byte(packet.player_count)
  ) {
    return false;
  }
  if (
    packet.sequence == 0 ||
    packet.recipient_id >= kMaxPlayers ||
    packet.player_count > kMaxPlayers
  ) {
    return false;
  }
  for (std::uint32_t index = 0; index < packet.player_count; ++index) {
    if (!read_player(reader, packet.players[index])) return false;
    for (std::uint32_t previous = 0; previous < index; ++previous) {
      if (packet.players[previous].id == packet.players[index].id) return false;
    }
  }
  return reader.finished();
}

}  // namespace cs::net
