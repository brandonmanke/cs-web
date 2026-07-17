# Third-party source

The shared simulation core has no runtime dependencies. These two pinned,
single-header libraries are client-side asset-decoding implementation details:

- `cgltf/cgltf.h` — cgltf v1.15 from
  <https://github.com/jkuhlmann/cgltf/tree/v1.15>, MIT license (license text is
  included at the end of the header).
- `stb/stb_image.h` — stb_image at commit
  `f58f558c120e9b32c217290b80bad1a0729fbb2c` from
  <https://github.com/nothings/stb>, public-domain or MIT dual license (license
  text is included at the end of the header).

Do not update either file without recording the new tag/commit here and running
the native simulation tests plus the WebAssembly browser smoke test.

The optional native multiplayer server uses `libdatachannel` v0.24.5 from
<https://github.com/paullouisageneau/libdatachannel>, MPL-2.0. CMake FetchContent
downloads that pinned tag only when `CS_ENABLE_WEBRTC_SERVER=ON`; it is not
vendored into this repository and is not linked into the shared simulation or
browser client. Media support, examples, and upstream tests are disabled for the
smallest server-only build.
