#include "cs/server.h"
#include "cs/server_security.h"

#include <rtc/rtc.hpp>
#include <rtc/websocketserver.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <variant>

namespace {

volatile std::sig_atomic_t stop_requested = 0;

constexpr std::uint32_t kHandshakeTimeoutTicks = 10U * 64U;
constexpr std::uint32_t kInputRateWindowTicks = 64U;
constexpr std::uint32_t kMaxInputPacketsPerWindow = 256U;
constexpr std::uint32_t kMaxSignalMessages = 96U;
constexpr std::uint32_t kMaxRemoteCandidates = 64U;
constexpr std::size_t kMaxSdpBytes = 32768U;
constexpr std::size_t kMaxCandidateBytes = 2048U;
constexpr std::size_t kMaxPendingSignaling = 32U;

void stop_server(int) {
  stop_requested = 1;
}

struct ClientConnection {
  std::uint8_t player_id = 0;
  std::uint32_t accepted_tick = 0;
  std::uint32_t input_window_tick = 0;
  std::uint32_t input_packets = 0;
  std::uint32_t signal_messages = 0;
  std::uint32_t remote_candidates = 0;
  bool offer_received = false;
  bool channel_open = false;
  std::shared_ptr<rtc::WebSocket> signaling;
  std::shared_ptr<rtc::PeerConnection> peer;
  std::shared_ptr<rtc::DataChannel> game;
};

struct OutgoingSnapshot {
  std::shared_ptr<rtc::DataChannel> channel;
  std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
  std::size_t size = 0;
};

void close_client(const std::shared_ptr<ClientConnection>& client) {
  if (client->game != nullptr) client->game->close();
  if (client->peer != nullptr) client->peer->close();
  if (client->signaling != nullptr) client->signaling->close();
}

class GameRuntime {
 public:
  GameRuntime() {
    cs::server::initialize(server_);
  }

  void admit(
    const std::shared_ptr<rtc::WebSocket>& socket,
    const std::string& token
  ) {
    bool stored = false;
    {
      const std::lock_guard lock(mutex_);
      for (std::shared_ptr<rtc::WebSocket>& pending : pending_) {
        if (pending != nullptr) continue;
        pending = socket;
        stored = true;
        break;
      }
    }
    if (!stored) {
      socket->close();
      return;
    }

    const std::weak_ptr<rtc::WebSocket> weak = socket;
    socket->onOpen([this, token, weak]() {
      const auto socket = weak.lock();
      if (socket == nullptr) return;
      release_pending(socket);
      const auto path = socket->path();
      if (
        !path.has_value() ||
        !cs::security::authorized_signaling_path(*path, token)
      ) {
        socket->send("UNAUTHORIZED\n");
        socket->close();
        return;
      }
      accept(socket);
    });
    socket->onClosed([this, weak]() {
      if (const auto socket = weak.lock()) release_pending(socket);
    });
    socket->onError([this, weak](std::string) {
      if (const auto socket = weak.lock()) release_pending(socket);
    });
  }

  void accept(std::shared_ptr<rtc::WebSocket> socket) {
    int player_id = -1;
    std::shared_ptr<ClientConnection> client;
    {
      const std::lock_guard lock(mutex_);
      player_id = cs::server::connect(server_);
      if (player_id >= 0) {
        client = std::make_shared<ClientConnection>();
        client->player_id = static_cast<std::uint8_t>(player_id);
        client->accepted_tick = server_.tick;
        client->input_window_tick = server_.tick;
        client->signaling = socket;
        clients_[client->player_id] = client;
      }
    }
    if (client == nullptr) {
      socket->send("FULL\n");
      socket->close();
      return;
    }

    const std::weak_ptr<ClientConnection> weak = client;
    socket->onMessage([this, weak](rtc::message_variant message) {
      if (const auto client = weak.lock()) {
        if (!std::holds_alternative<std::string>(message)) {
          reject(client, "binary signaling message");
          return;
        }
        handle_signal(client, std::get<std::string>(std::move(message)));
      }
    });
    socket->onClosed([this, weak]() {
      if (const auto client = weak.lock()) disconnect(client);
    });
    socket->onError([id = client->player_id](std::string error) {
      std::fprintf(stderr, "signaling error for player %u: %s\n", id, error.c_str());
    });
    std::printf("player %d connected to signaling\n", player_id);
  }

  void tick() {
    std::array<OutgoingSnapshot, cs::net::kMaxPlayers> outgoing{};
    std::array<std::shared_ptr<ClientConnection>, cs::net::kMaxPlayers> expired{};
    std::uint32_t outgoing_count = 0;
    std::uint32_t expired_count = 0;
    {
      const std::lock_guard lock(mutex_);
      cs::server::step(server_);
      for (std::uint8_t id = 0; id < cs::net::kMaxPlayers; ++id) {
        const std::shared_ptr<ClientConnection>& client = clients_[id];
        if (client == nullptr) continue;
        if (
          !client->channel_open &&
          server_.tick - client->accepted_tick >= kHandshakeTimeoutTicks
        ) {
          expired[expired_count++] = client;
          cs::server::disconnect(server_, id);
          clients_[id].reset();
          continue;
        }
        if (
          server_.tick % 3U != 0U ||
          client->game == nullptr ||
          !client->game->isOpen()
        ) {
          continue;
        }
        OutgoingSnapshot& item = outgoing[outgoing_count];
        item.channel = client->game;
        const cs::net::SnapshotPacket packet = cs::server::snapshot(server_, id);
        if (cs::net::encode_snapshot(packet, item.bytes, item.size)) {
          ++outgoing_count;
        }
      }
    }
    for (std::uint32_t index = 0; index < expired_count; ++index) {
      std::fprintf(stderr, "player %u handshake timed out\n", expired[index]->player_id);
      close_client(expired[index]);
    }
    for (std::uint32_t index = 0; index < outgoing_count; ++index) {
      OutgoingSnapshot& item = outgoing[index];
      if (item.channel->bufferedAmount() < 65536) {
        item.channel->send(
          reinterpret_cast<const rtc::byte*>(item.bytes.data()),
          item.size
        );
      }
    }
  }

  void shutdown() {
    std::array<std::shared_ptr<ClientConnection>, cs::net::kMaxPlayers> clients;
    std::array<std::shared_ptr<rtc::WebSocket>, kMaxPendingSignaling> pending;
    {
      const std::lock_guard lock(mutex_);
      clients = std::move(clients_);
      pending = std::move(pending_);
      for (std::uint8_t id = 0; id < cs::net::kMaxPlayers; ++id) {
        cs::server::disconnect(server_, id);
      }
    }
    for (const std::shared_ptr<rtc::WebSocket>& socket : pending) {
      if (socket != nullptr) socket->close();
    }
    for (const std::shared_ptr<ClientConnection>& client : clients) {
      if (client == nullptr) continue;
      close_client(client);
    }
  }

 private:
  void release_pending(const std::shared_ptr<rtc::WebSocket>& socket) {
    const std::lock_guard lock(mutex_);
    for (std::shared_ptr<rtc::WebSocket>& pending : pending_) {
      if (pending == socket) {
        pending.reset();
        return;
      }
    }
  }

  bool current_client(const std::shared_ptr<ClientConnection>& client) const {
    return clients_[client->player_id] == client;
  }

  bool detach(const std::shared_ptr<ClientConnection>& client) {
    const std::lock_guard lock(mutex_);
    if (!current_client(client)) return false;
    cs::server::disconnect(server_, client->player_id);
    clients_[client->player_id].reset();
    return true;
  }

  void disconnect(const std::shared_ptr<ClientConnection>& client) {
    if (detach(client)) {
      std::printf("player %u disconnected\n", client->player_id);
    }
  }

  void reject(
    const std::shared_ptr<ClientConnection>& client,
    std::string_view reason
  ) {
    if (!detach(client)) return;
    std::fprintf(
      stderr,
      "player %u rejected: %.*s\n",
      client->player_id,
      static_cast<int>(reason.size()),
      reason.data()
    );
    close_client(client);
  }

  void handle_signal(
    const std::shared_ptr<ClientConnection>& client,
    const std::string& message
  ) {
    bool signal_limit = false;
    {
      const std::lock_guard lock(mutex_);
      if (!current_client(client)) return;
      ++client->signal_messages;
      signal_limit = client->signal_messages > kMaxSignalMessages;
    }
    if (signal_limit) {
      reject(client, "signaling message limit exceeded");
      return;
    }
    const std::size_t separator = message.find('\n');
    const std::string type = message.substr(0, separator);
    const std::string body = separator == std::string::npos ?
      std::string{} : message.substr(separator + 1U);
    try {
      if (type == "OFFER") {
        accept_offer(client, body);
      } else if (type == "CANDIDATE") {
        const std::size_t middle = body.find('\n');
        if (
          middle == std::string::npos ||
          middle == 0 ||
          middle > 32U ||
          middle + 1U == body.size() ||
          body.size() - middle - 1U > kMaxCandidateBytes
        ) {
          reject(client, "malformed ICE candidate");
          return;
        }
        std::shared_ptr<rtc::PeerConnection> peer;
        bool candidate_limit = false;
        {
          const std::lock_guard lock(mutex_);
          if (!current_client(client)) return;
          ++client->remote_candidates;
          candidate_limit = client->remote_candidates > kMaxRemoteCandidates;
          peer = client->peer;
        }
        if (candidate_limit) {
          reject(client, "ICE candidate limit exceeded");
          return;
        }
        if (peer != nullptr) {
          peer->addRemoteCandidate(rtc::Candidate(
            body.substr(middle + 1U),
            body.substr(0, middle)
          ));
        }
      } else {
        reject(client, "unknown signaling message");
      }
    } catch (const std::exception& error) {
      std::fprintf(stderr, "signaling rejected for player %u: %s\n", client->player_id, error.what());
      reject(client, "invalid signaling payload");
    }
  }

  void accept_offer(
    const std::shared_ptr<ClientConnection>& client,
    const std::string& sdp
  ) {
    if (sdp.empty() || sdp.size() > kMaxSdpBytes) {
      reject(client, "invalid SDP offer size");
      return;
    }
    bool duplicate_offer = false;
    {
      const std::lock_guard lock(mutex_);
      if (!current_client(client)) return;
      duplicate_offer = client->offer_received;
      client->offer_received = true;
    }
    if (duplicate_offer) {
      reject(client, "duplicate SDP offer");
      return;
    }
    rtc::Configuration configuration;
    configuration.maxMessageSize = cs::net::kMaxPacketBytes;
    auto peer = std::make_shared<rtc::PeerConnection>(configuration);
    const std::weak_ptr<ClientConnection> weak = client;

    peer->onLocalDescription([weak](rtc::Description description) {
      if (const auto client = weak.lock(); client != nullptr && client->signaling != nullptr) {
        client->signaling->send("ANSWER\n" + std::string(description));
      }
    });
    peer->onLocalCandidate([weak](rtc::Candidate candidate) {
      if (const auto client = weak.lock(); client != nullptr && client->signaling != nullptr) {
        client->signaling->send(
          "CANDIDATE\n" + candidate.mid() + "\n" + std::string(candidate)
        );
      }
    });
    peer->onStateChange([this, weak](rtc::PeerConnection::State state) {
      if (state == rtc::PeerConnection::State::Failed) {
        if (const auto client = weak.lock()) reject(client, "WebRTC negotiation failed");
      }
    });
    peer->onDataChannel([this, weak](std::shared_ptr<rtc::DataChannel> channel) {
      const auto client = weak.lock();
      if (client == nullptr) {
        channel->close();
        return;
      }
      if (channel->label() != "game") {
        channel->close();
        reject(client, "unexpected DataChannel");
        return;
      }
      bool duplicate_channel = false;
      {
        const std::lock_guard lock(mutex_);
        if (!current_client(client) || client->game != nullptr) {
          duplicate_channel = true;
        } else {
          client->game = channel;
        }
      }
      if (duplicate_channel) {
        channel->close();
        reject(client, "duplicate game DataChannel");
        return;
      }
      channel->onOpen([this, weak]() {
        const auto client = weak.lock();
        if (client == nullptr) return;
        {
          const std::lock_guard lock(mutex_);
          if (!current_client(client)) return;
          client->channel_open = true;
        }
        std::printf("player %u game channel open\n", client->player_id);
      });
      channel->onMessage([this, weak](rtc::message_variant message) {
        const auto client = weak.lock();
        if (client == nullptr) return;
        if (!std::holds_alternative<rtc::binary>(message)) {
          reject(client, "non-binary game packet");
          return;
        }
        const rtc::binary& binary = std::get<rtc::binary>(message);
        if (binary.empty() || binary.size() > cs::net::kMaxPacketBytes) {
          reject(client, "invalid game packet size");
          return;
        }
        bool rate_limited = false;
        {
          const std::lock_guard lock(mutex_);
          if (!current_client(client)) return;
          if (server_.tick - client->input_window_tick >= kInputRateWindowTicks) {
            client->input_window_tick = server_.tick;
            client->input_packets = 0;
          }
          ++client->input_packets;
          rate_limited = client->input_packets > kMaxInputPacketsPerWindow;
        }
        if (rate_limited) {
          reject(client, "input packet rate exceeded");
          return;
        }
        cs::net::InputPacket packet{};
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(binary.data());
        if (
          !cs::net::decode_input(std::span(bytes, binary.size()), packet) ||
          packet.player_id != client->player_id
        ) {
          reject(client, "invalid or spoofed input packet");
          return;
        }
        bool accepted = false;
        {
          const std::lock_guard lock(mutex_);
          if (!current_client(client)) return;
          accepted = cs::server::receive_input(server_, packet);
        }
        if (!accepted) reject(client, "input sequence outside receive window");
      });
      channel->onClosed([this, weak]() {
        if (const auto client = weak.lock()) disconnect(client);
      });
    });

    {
      const std::lock_guard lock(mutex_);
      if (!current_client(client) || client->peer != nullptr) return;
      client->peer = peer;
    }
    peer->setRemoteDescription(rtc::Description(sdp, "offer"));
  }

  mutable std::mutex mutex_;
  cs::server::Server server_{};
  std::array<std::shared_ptr<ClientConnection>, cs::net::kMaxPlayers> clients_{};
  std::array<std::shared_ptr<rtc::WebSocket>, kMaxPendingSignaling> pending_{};
};

std::uint16_t parse_port(int argc, char** argv) {
  if (argc < 2) return 8000;
  const long value = std::strtol(argv[1], nullptr, 10);
  if (value < 1 || value > 65535) return 8000;
  return static_cast<std::uint16_t>(value);
}

std::string signal_token() {
  const char* value = std::getenv("CS_SIGNAL_TOKEN");
  if (value == nullptr || !cs::security::valid_signal_token(value)) {
    throw std::runtime_error(
      "CS_SIGNAL_TOKEN must be 32-128 URL-safe characters (A-Z, a-z, 0-9, -, _)"
    );
  }
  return value;
}

std::string bind_address() {
  const char* value = std::getenv("CS_BIND_ADDRESS");
  return value == nullptr || value[0] == '\0' ? "127.0.0.1" : value;
}

}  // namespace

int run_server(int argc, char** argv) {
  std::signal(SIGINT, stop_server);
  std::signal(SIGTERM, stop_server);
  rtc::InitLogger(rtc::LogLevel::Warning);
  GameRuntime runtime;

  const std::uint16_t port = parse_port(argc, argv);
  const std::string token = signal_token();
  const std::string bind = bind_address();
  rtc::WebSocketServer::Configuration configuration;
  configuration.port = port;
  configuration.bindAddress = bind;
  configuration.connectionTimeout = std::chrono::seconds(10);
  configuration.maxMessageSize = kMaxSdpBytes + 16U;
  auto signaling = std::make_unique<rtc::WebSocketServer>(configuration);
  signaling->onClient([&runtime, &token](std::shared_ptr<rtc::WebSocket> socket) {
    runtime.admit(socket, token);
  });
  std::printf("CS-Web WebRTC server signaling on ws://%s:%u/game\n", bind.c_str(), port);
  if (bind != "127.0.0.1" && bind != "::1" && bind != "localhost") {
    std::fprintf(
      stderr,
      "warning: plaintext WebSocket signaling is bound beyond loopback; use a WSS reverse proxy\n"
    );
  }

  constexpr std::chrono::nanoseconds tick_time(15'625'000);
  auto next_tick = std::chrono::steady_clock::now();
  while (stop_requested == 0) {
    next_tick += tick_time;
    runtime.tick();
    std::this_thread::sleep_until(next_tick);
    if (std::chrono::steady_clock::now() - next_tick > std::chrono::milliseconds(100)) {
      next_tick = std::chrono::steady_clock::now();
    }
  }

  signaling->stop();
  runtime.shutdown();
  signaling.reset();
  rtc::Cleanup().wait();
  return 0;
}

int main(int argc, char** argv) {
  try {
    return run_server(argc, argv);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "server failed: %s\n", error.what());
    rtc::Cleanup().wait();
    return 1;
  }
}
