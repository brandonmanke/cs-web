#pragma once

#include <cstddef>
#include <string_view>

namespace cs::security {

inline constexpr std::size_t kMinSignalTokenLength = 32;
inline constexpr std::size_t kMaxSignalTokenLength = 128;

bool valid_signal_token(std::string_view token);
bool authorized_signaling_path(
  std::string_view path,
  std::string_view expected_token
);

}  // namespace cs::security
