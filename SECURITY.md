# Security

## Current trust model

The browser is untrusted. The native C++ server owns movement, collision, weapon
timing, ammo, hits, damage, health, respawns, and score. A client can submit only
bounded input commands for the player ID assigned to its authenticated WebRTC
connection.

The current multiplayer demo is suitable for local and private testing, not an
anonymous public launch. Its signaling token is a shared, short-lived admission
secret rather than an account, identity, matchmaking, or anti-cheat system.

## Controls in place

- Signaling requires `CS_SIGNAL_TOKEN`, a 32–128 character URL-safe secret, on
  the exact `/game?token=...` endpoint. Comparisons do not short-circuit on token
  contents.
- The browser reads the secret from `#token=...`; URL fragments are not sent to
  the static HTTP server. The WebSocket endpoint still receives the token, so a
  public deployment must avoid logging query strings.
- Signaling binds to `127.0.0.1` by default. Binding elsewhere requires an
  explicit `CS_BIND_ADDRESS` setting and emits a plaintext-transport warning.
- Incomplete WebRTC handshakes lose their player slot after 10 seconds.
- SDP size, signaling-message count, ICE-candidate size/count, DataChannel packet
  size, and input packet rate are bounded. Malformed, spoofed, or out-of-window
  packets disconnect the sender.
- Binary packets have a versioned fixed schema with strict length, range,
  reserved-bit, finite-number, player-ID, and sequence-window validation.
- Hitscan rewind is capped at 13 server ticks; clients cannot request arbitrary
  historical hits.
- WebRTC DataChannels use DTLS. This does not secure plaintext WebSocket
  signaling against a man-in-the-middle, which is why WSS is mandatory outside
  loopback.

## Public deployment gate (M7)

Before Internet exposure:

1. Put signaling behind HTTPS/WSS and reject every browser `Origin` except the
   production client origin. The embedded WebSocket server does not expose the
   Origin header to this application, so this check belongs at the proxy.
2. Replace the shared demo secret with short-lived, single-room admission tokens
   issued by the lobby service. Rotate them and never log them.
3. Rate-limit upgrade attempts and concurrent connections per source at the
   edge; set request/header/body/time limits there as well.
4. Use authenticated, expiring TURN credentials and restrict relay allocation;
   do not ship permanent TURN secrets to the browser.
5. Run the game server as an unprivileged user in a container with CPU/memory/
   file-descriptor limits, read-only assets, and no cloud metadata credentials.
6. Add structured security telemetry without packet contents or tokens, then run
   protocol fuzzing and a multi-client load/abuse test before the public playtest.

Known M7 gaps are persistent identity/bans, lobby token issuance, edge Origin/IP
enforcement, TURN deployment, container hardening, and protocol fuzzing. Server
authority limits cheating impact, but a native browser client cannot be treated
as secret or tamper-proof.

Protocol basis: [RFC 6455 WebSocket security considerations](https://www.rfc-editor.org/rfc/rfc6455#section-10),
[RFC 8826 WebRTC security considerations](https://www.rfc-editor.org/rfc/rfc8826),
and [RFC 8831 WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831).
