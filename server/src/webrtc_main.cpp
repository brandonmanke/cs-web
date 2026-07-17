#include "cs/server.h"

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
#include <string>
#include <thread>
#include <variant>

namespace {

volatile std::sig_atomic_t stop_requested = 0;

void stop_server(int) {
  stop_requested = 1;
}

struct ClientConnection {
  std::uint8_t player_id = 0;
  std::shared_ptr<rtc::WebSocket> signaling;
  std::shared_ptr<rtc::PeerConnection> peer;
  std::shared_ptr<rtc::DataChannel> game;
};

struct OutgoingSnapshot {
  std::shared_ptr<rtc::DataChannel> channel;
  std::array<std::uint8_t, cs::net::kMaxPacketBytes> bytes{};
  std::size_t size = 0;
};

class GameRuntime {
 public:
  GameRuntime() {
    cs::server::initialize(server_);
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
      if (!std::holds_alternative<std::string>(message)) return;
      if (const auto client = weak.lock()) {
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
    std::uint32_t outgoing_count = 0;
    {
      const std::lock_guard lock(mutex_);
      cs::server::step(server_);
      if (server_.tick % 3U != 0U) return;
      for (const std::shared_ptr<ClientConnection>& client : clients_) {
        if (client == nullptr || client->game == nullptr || !client->game->isOpen()) continue;
        OutgoingSnapshot& item = outgoing[outgoing_count];
        item.channel = client->game;
        const cs::net::SnapshotPacket packet = cs::server::snapshot(
          server_,
          client->player_id
        );
        if (cs::net::encode_snapshot(packet, item.bytes, item.size)) ++outgoing_count;
      }
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
    {
      const std::lock_guard lock(mutex_);
      clients = std::move(clients_);
      for (std::uint8_t id = 0; id < cs::net::kMaxPlayers; ++id) {
        cs::server::disconnect(server_, id);
      }
    }
    for (const std::shared_ptr<ClientConnection>& client : clients) {
      if (client == nullptr) continue;
      if (client->game != nullptr) client->game->close();
      if (client->peer != nullptr) client->peer->close();
      if (client->signaling != nullptr) client->signaling->close();
    }
  }

 private:
  bool current_client(const std::shared_ptr<ClientConnection>& client) const {
    return clients_[client->player_id] == client;
  }

  void disconnect(const std::shared_ptr<ClientConnection>& client) {
    const std::lock_guard lock(mutex_);
    if (!current_client(client)) return;
    cs::server::disconnect(server_, client->player_id);
    clients_[client->player_id].reset();
    std::printf("player %u disconnected\n", client->player_id);
  }

  void handle_signal(
    const std::shared_ptr<ClientConnection>& client,
    const std::string& message
  ) {
    const std::size_t separator = message.find('\n');
    const std::string type = message.substr(0, separator);
    const std::string body = separator == std::string::npos ?
      std::string{} : message.substr(separator + 1U);
    try {
      if (type == "OFFER") {
        accept_offer(client, body);
      } else if (type == "CANDIDATE") {
        const std::size_t middle = body.find('\n');
        if (middle == std::string::npos) return;
        std::shared_ptr<rtc::PeerConnection> peer;
        {
          const std::lock_guard lock(mutex_);
          if (!current_client(client)) return;
          peer = client->peer;
        }
        if (peer != nullptr) {
          peer->addRemoteCandidate(rtc::Candidate(
            body.substr(middle + 1U),
            body.substr(0, middle)
          ));
        }
      }
    } catch (const std::exception& error) {
      std::fprintf(stderr, "signaling rejected for player %u: %s\n", client->player_id, error.what());
    }
  }

  void accept_offer(
    const std::shared_ptr<ClientConnection>& client,
    const std::string& sdp
  ) {
    if (sdp.empty() || sdp.size() > 65536) return;
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
    peer->onStateChange([id = client->player_id](rtc::PeerConnection::State state) {
      if (state == rtc::PeerConnection::State::Failed) {
        std::fprintf(stderr, "WebRTC failed for player %u\n", id);
      }
    });
    peer->onDataChannel([this, weak](std::shared_ptr<rtc::DataChannel> channel) {
      const auto client = weak.lock();
      if (client == nullptr || channel->label() != "game") {
        channel->close();
        return;
      }
      channel->onOpen([id = client->player_id]() {
        std::printf("player %u game channel open\n", id);
      });
      channel->onMessage([this, weak](rtc::message_variant message) {
        const auto client = weak.lock();
        if (client == nullptr || !std::holds_alternative<rtc::binary>(message)) return;
        const rtc::binary& binary = std::get<rtc::binary>(message);
        if (binary.size() > cs::net::kMaxPacketBytes) return;
        cs::net::InputPacket packet{};
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(binary.data());
        if (!cs::net::decode_input(std::span(bytes, binary.size()), packet)) return;
        if (packet.player_id != client->player_id) return;
        const std::lock_guard lock(mutex_);
        if (current_client(client)) cs::server::receive_input(server_, packet);
      });
      channel->onClosed([id = client->player_id]() {
        std::printf("player %u game channel closed\n", id);
      });
      const std::lock_guard lock(mutex_);
      if (current_client(client)) client->game = std::move(channel);
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
};

std::uint16_t parse_port(int argc, char** argv) {
  if (argc < 2) return 8000;
  const long value = std::strtol(argv[1], nullptr, 10);
  if (value < 1 || value > 65535) return 8000;
  return static_cast<std::uint16_t>(value);
}

}  // namespace

int run_server(int argc, char** argv) {
  std::signal(SIGINT, stop_server);
  std::signal(SIGTERM, stop_server);
  rtc::InitLogger(rtc::LogLevel::Warning);
  GameRuntime runtime;

  const std::uint16_t port = parse_port(argc, argv);
  rtc::WebSocketServer::Configuration configuration;
  configuration.port = port;
  configuration.maxMessageSize = 65536;
  auto signaling = std::make_unique<rtc::WebSocketServer>(configuration);
  signaling->onClient([&runtime](std::shared_ptr<rtc::WebSocket> socket) {
    runtime.accept(std::move(socket));
  });
  std::printf("CS-Web WebRTC server signaling on ws://127.0.0.1:%u\n", port);

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
