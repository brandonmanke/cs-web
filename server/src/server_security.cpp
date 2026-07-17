#include "cs/server_security.h"

#include <cstddef>
#include <string_view>

namespace cs::security {
namespace {

constexpr std::string_view kSignalingPrefix = "/game?token=";

bool url_safe_character(char character) {
  return
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    (character >= '0' && character <= '9') ||
    character == '-' ||
    character == '_';
}

bool constant_time_equal(std::string_view first, std::string_view second) {
  if (first.size() != second.size()) return false;
  unsigned char difference = 0;
  for (std::size_t index = 0; index < first.size(); ++index) {
    difference |= static_cast<unsigned char>(first[index]) ^
      static_cast<unsigned char>(second[index]);
  }
  return difference == 0;
}

}  // namespace

bool valid_signal_token(std::string_view token) {
  if (
    token.size() < kMinSignalTokenLength ||
    token.size() > kMaxSignalTokenLength
  ) {
    return false;
  }
  for (const char character : token) {
    if (!url_safe_character(character)) return false;
  }
  return true;
}

bool authorized_signaling_path(
  std::string_view path,
  std::string_view expected_token
) {
  if (
    !valid_signal_token(expected_token) ||
    !path.starts_with(kSignalingPrefix)
  ) {
    return false;
  }
  return constant_time_equal(path.substr(kSignalingPrefix.size()), expected_token);
}

}  // namespace cs::security
