#include "browser_net.h"

#include <emscripten.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace {

constexpr std::size_t kQueueSize = 8;

struct IncomingQueue {
  std::array<std::array<std::uint8_t, cs::net::kMaxPacketBytes>, kQueueSize> packets{};
  std::array<std::size_t, kQueueSize> sizes{};
  std::size_t read = 0;
  std::size_t write = 0;
  bool connected = false;
};

IncomingQueue incoming;

EM_JS(int, js_online_requested, (), {
  return new URLSearchParams(window.location.search).get('online') === '1';
});

EM_JS(void, js_net_start, (), {
  if (Module.csNet) return;
  const query = new URLSearchParams(window.location.search);
  const slash = String.fromCharCode(47);
  const newline = String.fromCharCode(10);
  const signalingUrl = query.get('signal') || 'ws:' + slash + slash + window.location.hostname + ':8000';
  const status = document.getElementById('status');
  const net = Module.csNet = {
    ws: null,
    pc: null,
    dc: null,
    candidates: [],
  };

  const setStatus = (message, failed = false) => {
    if (!status) return;
    status.textContent = message;
    status.className = failed ? 'failed' : String();
  };
  const fail = (message) => {
    console.error(message);
    setStatus(`NETWORK ERROR - ${message}`, true);
    Module._cs_net_set_connected(0);
  };
  const setupChannel = (channel) => {
    net.dc = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      setStatus('M4 ONLINE - C++ / WEBRTC / 64 HZ');
      if (status) status.classList.add('ready');
      Module._cs_net_set_connected(1);
    };
    channel.onclose = () => {
      setStatus('M4 DISCONNECTED', true);
      Module._cs_net_set_connected(0);
    };
    channel.onerror = () => fail('DataChannel failure');
    channel.onmessage = async (event) => {
      const buffer = event.data instanceof ArrayBuffer ? event.data : await event.data.arrayBuffer();
      if (buffer.byteLength > 512) return;
      const pointer = Module._malloc(buffer.byteLength);
      HEAPU8.set(new Uint8Array(buffer), pointer);
      Module._cs_net_receive(pointer, buffer.byteLength);
      Module._free(pointer);
    };
  };

  setStatus('M4 CONNECTING - WEBRTC');
  const ws = net.ws = new WebSocket(signalingUrl);
  const pc = net.pc = new RTCPeerConnection();
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') fail('PeerConnection failed');
  };
  pc.onicecandidate = (event) => {
    if (!event.candidate || ws.readyState !== WebSocket.OPEN) return;
    ws.send('CANDIDATE' + newline + (event.candidate.sdpMid || '0') + newline + event.candidate.candidate);
  };
  setupChannel(pc.createDataChannel('game', {
    ordered: false,
    maxRetransmits: 0,
  }));

  ws.onerror = () => fail(`cannot reach ${signalingUrl}`);
  ws.onclose = () => {
    if (!net.dc || net.dc.readyState !== 'open') fail('signaling disconnected');
  };
  ws.onmessage = async (event) => {
    if (typeof event.data !== 'string') return;
    const separator = event.data.indexOf(newline);
    const type = separator < 0 ? event.data : event.data.slice(0, separator);
    const body = separator < 0 ? String() : event.data.slice(separator + 1);
    try {
      if (type === 'ANSWER') {
        await pc.setRemoteDescription({type: 'answer', sdp: body});
        for (const candidate of net.candidates) await pc.addIceCandidate(candidate);
        net.candidates.length = 0;
      } else if (type === 'CANDIDATE') {
        const middle = body.indexOf(newline);
        if (middle < 0) return;
        const candidate = {
          sdpMid: body.slice(0, middle),
          candidate: body.slice(middle + 1),
        };
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else net.candidates.push(candidate);
      } else if (type === 'FULL') {
        fail('server is full');
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };
  ws.onopen = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send('OFFER' + newline + offer.sdp);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };
});

EM_JS(int, js_net_send, (const std::uint8_t* data, int size), {
  const channel = Module.csNet && Module.csNet.dc;
  if (!channel || channel.readyState !== 'open' || channel.bufferedAmount > 65536) return 0;
  channel.send(HEAPU8.slice(data, data + size));
  return 1;
});

EM_JS(void, js_net_game_status, (
  int player,
  int players,
  int tick,
  int ack,
  double x,
  double y,
  double z
), {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = 'M4 ONLINE - P' + (player + 1) + ' - ' + players +
    (players === 1 ? ' PLAYER' : ' PLAYERS') + ' - TICK ' + tick;
  status.dataset.ack = String(ack);
  status.dataset.position = x.toFixed(2) + ',' + y.toFixed(2) + ',' + z.toFixed(2);
  status.className = 'ready';
});

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void cs_net_set_connected(int connected) {
  incoming.connected = connected != 0;
}

EMSCRIPTEN_KEEPALIVE void cs_net_receive(const std::uint8_t* bytes, int size) {
  if (bytes == nullptr || size <= 0 || size > static_cast<int>(cs::net::kMaxPacketBytes)) return;
  const std::size_t next = (incoming.write + 1U) % kQueueSize;
  if (next == incoming.read) incoming.read = (incoming.read + 1U) % kQueueSize;
  std::memcpy(incoming.packets[incoming.write].data(), bytes, static_cast<std::size_t>(size));
  incoming.sizes[incoming.write] = static_cast<std::size_t>(size);
  incoming.write = next;
}

}  // extern "C"

namespace cs::client {

bool browser_online_requested() {
  return js_online_requested() != 0;
}

void browser_net_start() {
  js_net_start();
}

bool browser_net_connected() {
  return incoming.connected;
}

void browser_net_game_status(
  std::uint8_t player_id,
  std::uint8_t player_count,
  std::uint32_t server_tick,
  std::uint32_t acknowledged_input,
  Vec3 authoritative_origin
) {
  js_net_game_status(
    player_id,
    player_count,
    static_cast<int>(server_tick),
    static_cast<int>(acknowledged_input),
    authoritative_origin.x,
    authoritative_origin.y,
    authoritative_origin.z
  );
}

bool browser_net_send(std::span<const std::uint8_t> bytes) {
  if (bytes.empty() || bytes.size() > net::kMaxPacketBytes) return false;
  return js_net_send(bytes.data(), static_cast<int>(bytes.size())) != 0;
}

bool browser_net_receive(
  std::array<std::uint8_t, net::kMaxPacketBytes>& bytes,
  std::size_t& size
) {
  if (incoming.read == incoming.write) return false;
  size = incoming.sizes[incoming.read];
  std::copy_n(incoming.packets[incoming.read].begin(), size, bytes.begin());
  incoming.read = (incoming.read + 1U) % kQueueSize;
  return true;
}

}  // namespace cs::client
