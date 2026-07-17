#include "cs/sim.h"

#include <AL/al.h>
#include <AL/alc.h>
#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace {

struct Vec3 {
  float x;
  float y;
  float z;
};

struct Mat4 {
  std::array<float, 16> m{};
};

struct Vertex {
  float x;
  float y;
  float z;
  float r;
  float g;
  float b;
};

struct InputState {
  bool forward = false;
  bool back = false;
  bool left = false;
  bool right = false;
  bool jump = false;
  bool duck = false;
  bool fire = false;
  bool fire_pulse = false;
  bool reload = false;
  bool reload_pulse = false;
  std::uint32_t requested_weapon = cs::WeaponNone;
};

enum Sound : std::uint32_t {
  SoundShot = 0,
  SoundHit = 1,
  SoundDry = 2,
  SoundReload = 3,
  SoundCount = 4,
};

struct AudioState {
  ALCdevice* device = nullptr;
  ALCcontext* context = nullptr;
  std::array<ALuint, SoundCount> buffers{};
  std::array<ALuint, SoundCount> sources{};
  bool initialized = false;
};

struct ImpactMark {
  Vec3 position{};
  bool active = false;
};

struct ClientState {
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;
  GLuint program = 0;
  GLuint cube_vao = 0;
  GLuint cube_vertex_buffer = 0;
  GLuint cube_index_buffer = 0;
  GLuint ramp_vao = 0;
  GLuint ramp_vertex_buffer = 0;
  GLuint ramp_index_buffer = 0;
  GLint mvp_uniform = -1;
  GLint tint_uniform = -1;
  InputState input{};
  double previous_time = 0.0;
  double accumulator = 0.0;
  int canvas_width = 1;
  int canvas_height = 1;
  float yaw = 0.0F;
  float pitch = 0.0F;
  bool pointer_locked = false;
  std::uint32_t last_shot_sequence = 0;
  std::uint32_t previous_reload_ticks = 0;
  int muzzle_frames = 0;
  int hitmarker_frames = 0;
  std::array<ImpactMark, 64> impacts{};
  std::uint32_t next_impact = 0;
  AudioState audio{};
};

ClientState client;

EM_JS(int, browser_canvas_width, (), {
  return Math.max(1, Math.floor(window.innerWidth * window.devicePixelRatio));
});

EM_JS(int, browser_canvas_height, (), {
  return Math.max(1, Math.floor(window.innerHeight * window.devicePixelRatio));
});

Vec3 operator-(Vec3 a, Vec3 b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 operator+(Vec3 a, Vec3 b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 operator*(Vec3 value, float amount) {
  return {value.x * amount, value.y * amount, value.z * amount};
}

float dot(Vec3 a, Vec3 b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 cross(Vec3 a, Vec3 b) {
  return {
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  };
}

Vec3 normalize(Vec3 value) {
  const float length = std::sqrt(dot(value, value));
  return {value.x / length, value.y / length, value.z / length};
}

Mat4 multiply(const Mat4& a, const Mat4& b) {
  Mat4 result{};
  for (int column = 0; column < 4; ++column) {
    for (int row = 0; row < 4; ++row) {
      for (int index = 0; index < 4; ++index) {
        result.m[column * 4 + row] +=
          a.m[index * 4 + row] * b.m[column * 4 + index];
      }
    }
  }
  return result;
}

Mat4 perspective(float vertical_fov, float aspect, float near_plane, float far_plane) {
  const float focal = 1.0F / std::tan(vertical_fov * 0.5F);
  Mat4 result{};
  result.m[0] = focal / aspect;
  result.m[5] = focal;
  result.m[10] = (far_plane + near_plane) / (near_plane - far_plane);
  result.m[11] = -1.0F;
  result.m[14] = (2.0F * far_plane * near_plane) / (near_plane - far_plane);
  return result;
}

Mat4 look_at(Vec3 eye, Vec3 target, Vec3 up) {
  const Vec3 forward = normalize(target - eye);
  const Vec3 side = normalize(cross(forward, up));
  const Vec3 camera_up = cross(side, forward);

  Mat4 result{};
  result.m[0] = side.x;
  result.m[1] = camera_up.x;
  result.m[2] = -forward.x;
  result.m[4] = side.y;
  result.m[5] = camera_up.y;
  result.m[6] = -forward.y;
  result.m[8] = side.z;
  result.m[9] = camera_up.z;
  result.m[10] = -forward.z;
  result.m[12] = -dot(side, eye);
  result.m[13] = -dot(camera_up, eye);
  result.m[14] = dot(forward, eye);
  result.m[15] = 1.0F;
  return result;
}

Mat4 model_matrix(Vec3 position, Vec3 scale) {
  Mat4 result{};
  result.m[0] = scale.x;
  result.m[5] = scale.y;
  result.m[10] = scale.z;
  result.m[12] = position.x;
  result.m[13] = position.y;
  result.m[14] = position.z;
  result.m[15] = 1.0F;
  return result;
}

Mat4 model_matrix_basis(
  Vec3 position,
  Vec3 right,
  Vec3 up,
  Vec3 forward,
  Vec3 scale
) {
  Mat4 result{};
  result.m[0] = right.x * scale.x;
  result.m[1] = right.y * scale.x;
  result.m[2] = right.z * scale.x;
  result.m[4] = up.x * scale.y;
  result.m[5] = up.y * scale.y;
  result.m[6] = up.z * scale.y;
  result.m[8] = forward.x * scale.z;
  result.m[9] = forward.y * scale.z;
  result.m[10] = forward.z * scale.z;
  result.m[12] = position.x;
  result.m[13] = position.y;
  result.m[14] = position.z;
  result.m[15] = 1.0F;
  return result;
}

GLuint compile_shader(GLenum type, const char* source) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);

  GLint compiled = GL_FALSE;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
  if (compiled == GL_FALSE) {
    std::array<char, 1024> log{};
    glGetShaderInfoLog(shader, static_cast<GLsizei>(log.size()), nullptr, log.data());
    std::fprintf(stderr, "shader compile failed: %s\n", log.data());
  }
  return shader;
}

template <std::size_t VertexCount, std::size_t IndexCount>
void initialize_mesh(
  const std::array<Vertex, VertexCount>& vertices,
  const std::array<std::uint16_t, IndexCount>& indices,
  GLuint& vao,
  GLuint& vertex_buffer,
  GLuint& index_buffer
) {
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vertex_buffer);
  glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer);
  glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices.data(), GL_STATIC_DRAW);
  glGenBuffers(1, &index_buffer);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, index_buffer);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices.data(), GL_STATIC_DRAW);

  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), nullptr);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(
    1,
    3,
    GL_FLOAT,
    GL_FALSE,
    sizeof(Vertex),
    reinterpret_cast<const void*>(3 * sizeof(float))
  );
}

template <std::size_t SampleCount>
void upload_audio_buffer(
  ALuint buffer,
  const std::array<std::int16_t, SampleCount>& samples
) {
  alBufferData(
    buffer,
    AL_FORMAT_MONO16,
    samples.data(),
    static_cast<ALsizei>(samples.size() * sizeof(std::int16_t)),
    44100
  );
}

std::int16_t audio_sample(float value) {
  const float clamped = std::clamp(value, -1.0F, 1.0F);
  return static_cast<std::int16_t>(clamped * 32767.0F);
}

bool initialize_audio() {
  AudioState& audio = client.audio;
  if (audio.initialized) return true;
  audio.device = alcOpenDevice(nullptr);
  if (audio.device == nullptr) return false;
  audio.context = alcCreateContext(audio.device, nullptr);
  if (audio.context == nullptr || alcMakeContextCurrent(audio.context) == ALC_FALSE) {
    return false;
  }

  alGenBuffers(SoundCount, audio.buffers.data());
  alGenSources(SoundCount, audio.sources.data());
  constexpr float pi = 3.14159265358979323846F;
  std::uint32_t noise_state = 0xC0FFEEU;
  const auto noise = [&noise_state]() {
    noise_state ^= noise_state << 13U;
    noise_state ^= noise_state >> 17U;
    noise_state ^= noise_state << 5U;
    return static_cast<float>(noise_state & 0xFFFFU) / 32767.5F - 1.0F;
  };

  std::array<std::int16_t, 6000> shot{};
  for (std::size_t index = 0; index < shot.size(); ++index) {
    const float time = static_cast<float>(index) / 44100.0F;
    const float envelope = std::exp(-time * 25.0F);
    const float body = std::sin(2.0F * pi * (105.0F - time * 260.0F) * time);
    shot[index] = audio_sample((noise() * 0.72F + body * 0.28F) * envelope * 0.82F);
  }
  upload_audio_buffer(audio.buffers[SoundShot], shot);

  std::array<std::int16_t, 1800> hit{};
  for (std::size_t index = 0; index < hit.size(); ++index) {
    const float time = static_cast<float>(index) / 44100.0F;
    const float envelope = std::exp(-time * 75.0F);
    hit[index] = audio_sample(
      std::sin(2.0F * pi * 920.0F * time) * envelope * 0.42F
    );
  }
  upload_audio_buffer(audio.buffers[SoundHit], hit);

  std::array<std::int16_t, 1200> dry{};
  for (std::size_t index = 0; index < dry.size(); ++index) {
    const float time = static_cast<float>(index) / 44100.0F;
    const float envelope = std::exp(-time * 110.0F);
    dry[index] = audio_sample(
      (std::sin(2.0F * pi * 520.0F * time) + noise() * 0.15F) *
      envelope * 0.28F
    );
  }
  upload_audio_buffer(audio.buffers[SoundDry], dry);

  std::array<std::int16_t, 5000> reload{};
  for (std::size_t index = 0; index < reload.size(); ++index) {
    const float time = static_cast<float>(index) / 44100.0F;
    const float first = std::exp(-time * 95.0F);
    const float second_time = std::max(0.0F, time - 0.075F);
    const float second = time >= 0.075F ? std::exp(-second_time * 100.0F) : 0.0F;
    reload[index] = audio_sample(noise() * (first + second) * 0.32F);
  }
  upload_audio_buffer(audio.buffers[SoundReload], reload);

  for (std::uint32_t index = 0; index < SoundCount; ++index) {
    alSourcei(audio.sources[index], AL_BUFFER, audio.buffers[index]);
    alSourcef(audio.sources[index], AL_GAIN, 0.65F);
  }
  audio.initialized = true;
  return true;
}

void play_sound(Sound sound, float pitch = 1.0F) {
  if (!client.audio.initialized) return;
  const ALuint source = client.audio.sources[sound];
  alSourceStop(source);
  alSourcef(source, AL_PITCH, pitch);
  alSourcePlay(source);
}

void process_sim_events(const cs::SimSnapshot& snapshot) {
  if (snapshot.last_shot.sequence != client.last_shot_sequence) {
    client.last_shot_sequence = snapshot.last_shot.sequence;
    if (snapshot.last_shot.result == cs::ShotDry) {
      play_sound(SoundDry);
    } else {
      play_sound(SoundShot, 0.88F + static_cast<float>(snapshot.weapon) * 0.035F);
      client.muzzle_frames = 3;
      if (
        snapshot.last_shot.result == cs::ShotHit ||
        snapshot.last_shot.result == cs::ShotKill
      ) {
        play_sound(SoundHit, snapshot.last_shot.result == cs::ShotKill ? 1.3F : 1.0F);
        client.hitmarker_frames = 9;
      }
      if (snapshot.last_shot.result == cs::ShotWorld) {
        ImpactMark& impact = client.impacts[
          client.next_impact++ % client.impacts.size()
        ];
        impact.position = {
          snapshot.last_shot.end.x,
          snapshot.last_shot.end.y,
          snapshot.last_shot.end.z,
        };
        impact.active = true;
      }
    }
  }
  if (snapshot.reload_ticks > 0 && client.previous_reload_ticks == 0) {
    play_sound(SoundReload);
  }
  client.previous_reload_ticks = snapshot.reload_ticks;
}

bool initialize_renderer() {
  EmscriptenWebGLContextAttributes attributes{};
  emscripten_webgl_init_context_attributes(&attributes);
  attributes.alpha = EM_FALSE;
  attributes.antialias = EM_FALSE;
  attributes.majorVersion = 2;
  attributes.minorVersion = 0;
  client.context = emscripten_webgl_create_context("#canvas", &attributes);
  if (client.context <= 0) {
    std::fputs("unable to create a WebGL2 context\n", stderr);
    return false;
  }
  emscripten_webgl_make_context_current(client.context);

  constexpr const char* vertex_source = R"(#version 300 es
    layout(location = 0) in vec3 a_position;
    layout(location = 1) in vec3 a_color;
    uniform mat4 u_mvp;
    uniform vec3 u_tint;
    out vec3 v_color;
    void main() {
      gl_Position = u_mvp * vec4(a_position, 1.0);
      v_color = a_color * u_tint;
    }
  )";
  constexpr const char* fragment_source = R"(#version 300 es
    precision mediump float;
    in vec3 v_color;
    out vec4 out_color;
    void main() {
      out_color = vec4(v_color, 1.0);
    }
  )";

  const GLuint vertex_shader = compile_shader(GL_VERTEX_SHADER, vertex_source);
  const GLuint fragment_shader = compile_shader(GL_FRAGMENT_SHADER, fragment_source);
  client.program = glCreateProgram();
  glAttachShader(client.program, vertex_shader);
  glAttachShader(client.program, fragment_shader);
  glLinkProgram(client.program);
  glDeleteShader(vertex_shader);
  glDeleteShader(fragment_shader);

  GLint linked = GL_FALSE;
  glGetProgramiv(client.program, GL_LINK_STATUS, &linked);
  if (linked == GL_FALSE) {
    std::fputs("shader program link failed\n", stderr);
    return false;
  }

  constexpr std::array<Vertex, 8> cube_vertices{{
    {-0.5F, -0.5F, -0.5F, 0.72F, 0.78F, 0.68F},
    { 0.5F, -0.5F, -0.5F, 0.82F, 0.74F, 0.58F},
    { 0.5F,  0.5F, -0.5F, 0.66F, 0.73F, 0.62F},
    {-0.5F,  0.5F, -0.5F, 0.76F, 0.69F, 0.54F},
    {-0.5F, -0.5F,  0.5F, 0.62F, 0.68F, 0.58F},
    { 0.5F, -0.5F,  0.5F, 0.74F, 0.66F, 0.52F},
    { 0.5F,  0.5F,  0.5F, 0.58F, 0.66F, 0.56F},
    {-0.5F,  0.5F,  0.5F, 0.68F, 0.62F, 0.48F},
  }};
  constexpr std::array<std::uint16_t, 36> cube_indices{{
    0, 1, 2, 0, 2, 3,
    5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7,
    1, 5, 6, 1, 6, 2,
    3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0,
  }};
  constexpr std::array<Vertex, 6> ramp_vertices{{
    {-0.5F, 0.0F, -0.5F, 0.62F, 0.68F, 0.58F},
    { 0.5F, 0.0F, -0.5F, 0.72F, 0.66F, 0.52F},
    {-0.5F, 1.0F, -0.5F, 0.74F, 0.78F, 0.66F},
    { 0.5F, 1.0F, -0.5F, 0.82F, 0.74F, 0.58F},
    {-0.5F, 0.0F,  0.5F, 0.56F, 0.62F, 0.52F},
    { 0.5F, 0.0F,  0.5F, 0.66F, 0.60F, 0.48F},
  }};
  constexpr std::array<std::uint16_t, 24> ramp_indices{{
    0, 4, 5, 0, 5, 1,
    0, 1, 3, 0, 3, 2,
    2, 3, 5, 2, 5, 4,
    0, 2, 4, 1, 5, 3,
  }};

  initialize_mesh(
    cube_vertices,
    cube_indices,
    client.cube_vao,
    client.cube_vertex_buffer,
    client.cube_index_buffer
  );
  initialize_mesh(
    ramp_vertices,
    ramp_indices,
    client.ramp_vao,
    client.ramp_vertex_buffer,
    client.ramp_index_buffer
  );

  client.mvp_uniform = glGetUniformLocation(client.program, "u_mvp");
  client.tint_uniform = glGetUniformLocation(client.program, "u_tint");
  glEnable(GL_DEPTH_TEST);
  glDisable(GL_CULL_FACE);
  return true;
}

void resize_canvas() {
  const int width = browser_canvas_width();
  const int height = browser_canvas_height();
  if (width == client.canvas_width && height == client.canvas_height) {
    return;
  }
  client.canvas_width = width;
  client.canvas_height = height;
  emscripten_set_canvas_element_size("#canvas", width, height);
}

void draw_cube(const Mat4& view_projection, Vec3 position, Vec3 scale, Vec3 tint) {
  const Mat4 mvp = multiply(view_projection, model_matrix(position, scale));
  glUniformMatrix4fv(client.mvp_uniform, 1, GL_FALSE, mvp.m.data());
  glUniform3f(client.tint_uniform, tint.x, tint.y, tint.z);
  glBindVertexArray(client.cube_vao);
  glDrawElements(GL_TRIANGLES, 36, GL_UNSIGNED_SHORT, nullptr);
}

void draw_oriented_cube(
  const Mat4& view_projection,
  Vec3 position,
  Vec3 right,
  Vec3 up,
  Vec3 forward,
  Vec3 scale,
  Vec3 tint
) {
  const Mat4 mvp = multiply(
    view_projection,
    model_matrix_basis(position, right, up, forward, scale)
  );
  glUniformMatrix4fv(client.mvp_uniform, 1, GL_FALSE, mvp.m.data());
  glUniform3f(client.tint_uniform, tint.x, tint.y, tint.z);
  glBindVertexArray(client.cube_vao);
  glDrawElements(GL_TRIANGLES, 36, GL_UNSIGNED_SHORT, nullptr);
}

void draw_ramp(const Mat4& view_projection, Vec3 position, Vec3 scale, Vec3 tint) {
  const Mat4 mvp = multiply(view_projection, model_matrix(position, scale));
  glUniformMatrix4fv(client.mvp_uniform, 1, GL_FALSE, mvp.m.data());
  glUniform3f(client.tint_uniform, tint.x, tint.y, tint.z);
  glBindVertexArray(client.ramp_vao);
  glDrawElements(GL_TRIANGLES, 24, GL_UNSIGNED_SHORT, nullptr);
}

Vec3 material_tint(std::uint32_t material) {
  switch (material) {
    case cs::MaterialWood: return {0.78F, 0.50F, 0.28F};
    case cs::MaterialMetal: return {0.52F, 0.60F, 0.62F};
    case cs::MaterialSand: return {0.70F, 0.62F, 0.42F};
    default: return {0.64F, 0.66F, 0.58F};
  }
}

void draw_targets(const Mat4& view_projection, const cs::SimSnapshot& snapshot) {
  for (std::uint32_t index = 0; index < snapshot.target_count; ++index) {
    const cs::TargetSnapshot& target = snapshot.targets[index];
    if (target.alive == 0U) continue;
    const Vec3 base{target.origin.x, target.origin.y, target.origin.z};
    const Vec3 body_tint = target.hit_flash_ticks > 0
      ? Vec3{1.0F, 0.22F, 0.12F}
      : Vec3{0.28F, 0.48F, 0.72F};
    draw_cube(
      view_projection,
      base + Vec3{0.0F, 43.0F, 0.0F},
      {22.0F, 30.0F, 13.0F},
      body_tint
    );
    draw_cube(
      view_projection,
      base + Vec3{0.0F, 65.0F, 0.0F},
      {12.0F, 14.0F, 12.0F},
      target.hit_flash_ticks > 0 ? Vec3{1.0F, 0.52F, 0.16F} : Vec3{0.78F, 0.62F, 0.43F}
    );
    draw_cube(
      view_projection,
      base + Vec3{-6.0F, 13.0F, 0.0F},
      {8.0F, 26.0F, 10.0F},
      {0.20F, 0.28F, 0.42F}
    );
    draw_cube(
      view_projection,
      base + Vec3{6.0F, 13.0F, 0.0F},
      {8.0F, 26.0F, 10.0F},
      {0.20F, 0.28F, 0.42F}
    );
  }
}

void draw_impacts(const Mat4& view_projection) {
  for (const ImpactMark& impact : client.impacts) {
    if (!impact.active) continue;
    draw_cube(
      view_projection,
      impact.position,
      {2.2F, 2.2F, 2.2F},
      {0.05F, 0.045F, 0.035F}
    );
  }
}

Vec3 weapon_tint(std::uint32_t weapon) {
  switch (weapon) {
    case cs::WeaponUsp: return {0.42F, 0.44F, 0.40F};
    case cs::WeaponGlock: return {0.34F, 0.38F, 0.36F};
    case cs::WeaponAk47: return {0.56F, 0.31F, 0.16F};
    case cs::WeaponM4a1: return {0.32F, 0.38F, 0.34F};
    case cs::WeaponAwp: return {0.30F, 0.43F, 0.25F};
    case cs::WeaponMp5: return {0.28F, 0.31F, 0.30F};
    default: return {0.64F, 0.66F, 0.62F};
  }
}

void draw_viewmodel(
  const Mat4& view_projection,
  Vec3 eye,
  Vec3 forward,
  Vec3 right,
  Vec3 up,
  const cs::SimSnapshot& snapshot
) {
  glClear(GL_DEPTH_BUFFER_BIT);
  const float kick = snapshot.punch_pitch * 42.0F;
  const auto position = [eye, forward, right, up, kick](Vec3 offset) {
    return eye + right * offset.x + up * (offset.y - kick) + forward * offset.z;
  };
  const auto piece = [&](Vec3 offset, Vec3 size, Vec3 tint) {
    draw_oriented_cube(
      view_projection,
      position(offset),
      right,
      up,
      forward,
      size,
      tint
    );
  };
  const Vec3 hand{0.66F, 0.46F, 0.30F};
  const Vec3 tint = weapon_tint(snapshot.weapon);
  float muzzle_distance = 0.0F;

  if (snapshot.weapon == cs::WeaponKnife) {
    piece({9.0F, -10.0F, 18.0F}, {3.5F, 3.5F, 11.0F}, {0.20F, 0.18F, 0.14F});
    piece({9.0F, -8.0F, 30.0F}, {2.0F, 4.5F, 18.0F}, {0.72F, 0.76F, 0.70F});
    piece({5.0F, -12.0F, 12.0F}, {6.0F, 6.0F, 8.0F}, hand);
    return;
  }

  const bool pistol = snapshot.weapon == cs::WeaponUsp || snapshot.weapon == cs::WeaponGlock;
  if (pistol) {
    piece({9.0F, -8.0F, 19.0F}, {6.0F, 5.0F, 13.0F}, tint);
    piece({9.0F, -7.0F, 29.0F}, {2.2F, 2.2F, 10.0F}, {0.30F, 0.31F, 0.29F});
    piece({9.0F, -14.0F, 16.0F}, {4.5F, 11.0F, 6.0F}, {0.18F, 0.19F, 0.18F});
    piece({5.0F, -15.0F, 12.0F}, {7.0F, 7.0F, 9.0F}, hand);
    muzzle_distance = 35.0F;
  } else {
    const float barrel_length = snapshot.weapon == cs::WeaponAwp ? 25.0F : 18.0F;
    piece({10.0F, -9.0F, 22.0F}, {8.0F, 6.0F, 20.0F}, tint);
    piece({10.0F, -7.0F, 39.0F}, {2.5F, 2.5F, barrel_length}, {0.23F, 0.24F, 0.22F});
    piece({9.0F, -16.0F, 21.0F}, {4.5F, 11.0F, 7.0F}, {0.18F, 0.19F, 0.17F});
    piece({10.0F, -9.0F, 8.0F}, {7.0F, 7.0F, 10.0F}, tint * 0.78F);
    if (snapshot.weapon == cs::WeaponAwp) {
      piece({10.0F, -3.0F, 24.0F}, {5.0F, 4.5F, 13.0F}, {0.16F, 0.18F, 0.15F});
    }
    piece({4.0F, -15.0F, 18.0F}, {7.0F, 7.0F, 10.0F}, hand);
    muzzle_distance = snapshot.weapon == cs::WeaponAwp ? 54.0F : 49.0F;
  }

  if (client.muzzle_frames > 0) {
    piece(
      {10.0F, -7.0F, muzzle_distance},
      {7.0F, 7.0F, 5.0F},
      {1.0F, 0.72F, 0.14F}
    );
  }
}

void draw_rect(int x, int y, int width, int height, Vec3 color) {
  if (width <= 0 || height <= 0) return;
  glEnable(GL_SCISSOR_TEST);
  glClearColor(color.x, color.y, color.z, 1.0F);
  glScissor(x, y, width, height);
  glClear(GL_COLOR_BUFFER_BIT);
  glDisable(GL_SCISSOR_TEST);
}

void draw_digit(int x, int y, int scale_value, int digit, Vec3 color) {
  constexpr std::array<std::uint8_t, 10> masks{{
    0x3FU, 0x06U, 0x5BU, 0x4FU, 0x66U,
    0x6DU, 0x7DU, 0x07U, 0x7FU, 0x6FU,
  }};
  const std::uint8_t mask = masks[std::clamp(digit, 0, 9)];
  if ((mask & 0x01U) != 0U) draw_rect(x + scale_value, y + 4 * scale_value, 3 * scale_value, scale_value, color);
  if ((mask & 0x02U) != 0U) draw_rect(x + 4 * scale_value, y + 2 * scale_value, scale_value, 2 * scale_value, color);
  if ((mask & 0x04U) != 0U) draw_rect(x + 4 * scale_value, y, scale_value, 2 * scale_value, color);
  if ((mask & 0x08U) != 0U) draw_rect(x + scale_value, y, 3 * scale_value, scale_value, color);
  if ((mask & 0x10U) != 0U) draw_rect(x, y, scale_value, 2 * scale_value, color);
  if ((mask & 0x20U) != 0U) draw_rect(x, y + 2 * scale_value, scale_value, 2 * scale_value, color);
  if ((mask & 0x40U) != 0U) draw_rect(x + scale_value, y + 2 * scale_value, 3 * scale_value, scale_value, color);
}

int draw_number_right(int value, int right, int y, int scale_value, Vec3 color) {
  value = std::max(0, value);
  do {
    right -= 5 * scale_value;
    draw_digit(right, y, scale_value, value % 10, color);
    right -= scale_value;
    value /= 10;
  } while (value > 0);
  return right;
}

void draw_hud(const cs::SimSnapshot& snapshot) {
  const int scale_value = std::max(2, client.canvas_height / 220);
  const int bottom = 5 * scale_value;
  const Vec3 green{0.18F, 0.95F, 0.30F};
  const Vec3 amber{1.0F, 0.62F, 0.18F};
  const Vec3 ammo_color = snapshot.reload_ticks > 0 ? amber : green;
  int right = client.canvas_width - 4 * scale_value;
  right = draw_number_right(static_cast<int>(snapshot.reserve), right, bottom, scale_value, {0.54F, 0.70F, 0.48F});
  draw_rect(right - scale_value, bottom, scale_value, 5 * scale_value, {0.35F, 0.48F, 0.33F});
  draw_number_right(static_cast<int>(snapshot.magazine), right - 3 * scale_value, bottom, scale_value, ammo_color);
  draw_digit(4 * scale_value, bottom, scale_value, static_cast<int>(snapshot.weapon), amber);
  draw_number_right(
    static_cast<int>(snapshot.kills),
    client.canvas_width - 4 * scale_value,
    client.canvas_height - 8 * scale_value,
    scale_value,
    amber
  );

  if (client.hitmarker_frames > 0) {
    const int center_x = client.canvas_width / 2;
    const int center_y = client.canvas_height / 2;
    const Vec3 hit_color{1.0F, 0.84F, 0.22F};
    draw_rect(center_x - 11, center_y - 11, 4, 4, hit_color);
    draw_rect(center_x + 7, center_y - 11, 4, 4, hit_color);
    draw_rect(center_x - 11, center_y + 7, 4, 4, hit_color);
    draw_rect(center_x + 7, center_y + 7, 4, 4, hit_color);
  }
}

void draw_crosshair() {
  const int center_x = client.canvas_width / 2;
  const int center_y = client.canvas_height / 2;
  glEnable(GL_SCISSOR_TEST);
  glClearColor(0.18F, 0.95F, 0.3F, 1.0F);
  glScissor(center_x - 12, center_y - 1, 8, 2);
  glClear(GL_COLOR_BUFFER_BIT);
  glScissor(center_x + 4, center_y - 1, 8, 2);
  glClear(GL_COLOR_BUFFER_BIT);
  glScissor(center_x - 1, center_y + 4, 2, 8);
  glClear(GL_COLOR_BUFFER_BIT);
  glScissor(center_x - 1, center_y - 12, 2, 8);
  glClear(GL_COLOR_BUFFER_BIT);
  glDisable(GL_SCISSOR_TEST);
}

void render() {
  resize_canvas();
  glViewport(0, 0, client.canvas_width, client.canvas_height);
  glClearColor(0.035F, 0.045F, 0.04F, 1.0F);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  const float aspect = static_cast<float>(client.canvas_width) /
    static_cast<float>(client.canvas_height);
  const cs::SimSnapshot& snapshot = *sim_snapshot();
  const Vec3 eye{
    snapshot.player_origin.x,
    snapshot.player_origin.y + snapshot.view_height,
    snapshot.player_origin.z,
  };
  const float view_pitch = std::clamp(
    client.pitch + snapshot.punch_pitch,
    -1.5533F,
    1.5533F
  );
  const float view_yaw = client.yaw + snapshot.punch_yaw;
  const float pitch_cosine = std::cos(view_pitch);
  const Vec3 view_direction{
    std::sin(view_yaw) * pitch_cosine,
    std::sin(view_pitch),
    -std::cos(view_yaw) * pitch_cosine,
  };
  const Vec3 camera_right = normalize(cross(view_direction, {0.0F, 1.0F, 0.0F}));
  const Vec3 camera_up = cross(camera_right, view_direction);
  const Mat4 projection = perspective(1.309F, aspect, 1.0F, 4000.0F);
  const Mat4 view = look_at(
    eye,
    {eye.x + view_direction.x, eye.y + view_direction.y, eye.z + view_direction.z},
    {0.0F, 1.0F, 0.0F}
  );
  const Mat4 view_projection = multiply(projection, view);

  glUseProgram(client.program);
  for (const cs::BoxDefinition& box : cs::aim_arena_boxes()) {
    const Vec3 center{
      (box.mins.x + box.maxs.x) * 0.5F,
      (box.mins.y + box.maxs.y) * 0.5F,
      (box.mins.z + box.maxs.z) * 0.5F,
    };
    const Vec3 size{
      box.maxs.x - box.mins.x,
      box.maxs.y - box.mins.y,
      box.maxs.z - box.mins.z,
    };
    draw_cube(view_projection, center, size, material_tint(box.material));
  }
  for (const cs::RampDefinition& ramp : cs::aim_arena_ramps()) {
    draw_ramp(
      view_projection,
      {
        (ramp.min_x + ramp.max_x) * 0.5F,
        ramp.base_y,
        (ramp.min_z + ramp.max_z) * 0.5F,
      },
      {
        ramp.max_x - ramp.min_x,
        ramp.height,
        ramp.max_z - ramp.min_z,
      },
      material_tint(ramp.material)
    );
  }
  draw_impacts(view_projection);
  draw_targets(view_projection, snapshot);
  draw_viewmodel(
    view_projection,
    eye,
    view_direction,
    camera_right,
    camera_up,
    snapshot
  );
  draw_crosshair();
  draw_hud(snapshot);
  if (client.muzzle_frames > 0) --client.muzzle_frames;
  if (client.hitmarker_frames > 0) --client.hitmarker_frames;
}

EM_BOOL on_key(int event_type, const EmscriptenKeyboardEvent* event, void*) {
  const bool down = event_type == EMSCRIPTEN_EVENT_KEYDOWN;
  if (down && std::strncmp(event->code, "Digit", 5) == 0) {
    const int slot = event->code[5] - '0';
    if (slot >= cs::WeaponKnife && slot <= cs::WeaponMp5) {
      client.input.requested_weapon = static_cast<std::uint32_t>(slot);
      return EM_TRUE;
    }
  }
  bool* key = nullptr;
  if (std::strcmp(event->code, "KeyW") == 0) key = &client.input.forward;
  if (std::strcmp(event->code, "KeyS") == 0) key = &client.input.back;
  if (std::strcmp(event->code, "KeyA") == 0) key = &client.input.left;
  if (std::strcmp(event->code, "KeyD") == 0) key = &client.input.right;
  if (std::strcmp(event->code, "Space") == 0) key = &client.input.jump;
  if (std::strcmp(event->code, "KeyF") == 0) {
    key = &client.input.fire;
    if (down) client.input.fire_pulse = true;
  }
  if (std::strcmp(event->code, "KeyR") == 0) {
    key = &client.input.reload;
    if (down) client.input.reload_pulse = true;
  }
  if (
    std::strcmp(event->code, "ControlLeft") == 0 ||
    std::strcmp(event->code, "ControlRight") == 0 ||
    std::strcmp(event->code, "KeyC") == 0
  ) key = &client.input.duck;
  if (key == nullptr) return EM_FALSE;
  *key = down;
  return EM_TRUE;
}

EM_BOOL on_mouse_button(
  int event_type,
  const EmscriptenMouseEvent* event,
  void*
) {
  if (event->button != 0) return EM_FALSE;
  const bool down = event_type == EMSCRIPTEN_EVENT_MOUSEDOWN;
  if (down) {
    initialize_audio();
    client.input.fire_pulse = true;
    if (!client.pointer_locked) {
      emscripten_request_pointerlock("#canvas", EM_FALSE);
    }
  }
  client.input.fire = down;
  return EM_TRUE;
}

EM_BOOL on_pointer_lock(
  int,
  const EmscriptenPointerlockChangeEvent* event,
  void*
) {
  client.pointer_locked = event->isActive;
  if (!client.pointer_locked) client.input = {};
  return EM_TRUE;
}

EM_BOOL on_mouse_move(int, const EmscriptenMouseEvent* event, void*) {
  if (!client.pointer_locked) return EM_FALSE;
  constexpr float sensitivity = 0.0022F;
  client.yaw += static_cast<float>(event->movementX) * sensitivity;
  client.pitch -= static_cast<float>(event->movementY) * sensitivity;
  client.pitch = std::clamp(client.pitch, -1.5533F, 1.5533F);
  return EM_TRUE;
}

void frame() {
  const double now = emscripten_get_now() * 0.001;
  double elapsed = now - client.previous_time;
  client.previous_time = now;
  if (elapsed > 0.1) elapsed = 0.1;
  client.accumulator += elapsed;

  while (client.accumulator >= cs::kTickSeconds) {
    float forward = static_cast<float>(client.input.forward) -
      static_cast<float>(client.input.back);
    float strafe = static_cast<float>(client.input.right) -
      static_cast<float>(client.input.left);
    const float length = std::sqrt(forward * forward + strafe * strafe);
    if (length > 1.0F) {
      forward /= length;
      strafe /= length;
    }
    std::uint32_t buttons = 0;
    if (client.input.jump) buttons |= cs::ButtonJump;
    if (client.input.duck) buttons |= cs::ButtonDuck;
    if (client.input.fire || client.input.fire_pulse) buttons |= cs::ButtonFire;
    if (client.input.reload || client.input.reload_pulse) buttons |= cs::ButtonReload;
    const cs::InputCommand command{
      .forward = forward,
      .strafe = strafe,
      .yaw = client.yaw,
      .pitch = client.pitch,
      .buttons = buttons,
      .requested_weapon = client.input.requested_weapon,
    };
    sim_step(&command);
    process_sim_events(*sim_snapshot());
    client.input.fire_pulse = false;
    client.input.reload_pulse = false;
    client.input.requested_weapon = cs::WeaponNone;
    client.accumulator -= cs::kTickSeconds;
  }
  render();
}

}  // namespace

int main() {
  sim_create();
  if (!initialize_renderer()) return 1;

  emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_key);
  emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_key);
  emscripten_set_mousedown_callback("#canvas", nullptr, EM_TRUE, on_mouse_button);
  emscripten_set_mouseup_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_mouse_button);
  emscripten_set_mousemove_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_mouse_move);
  emscripten_set_pointerlockchange_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_pointer_lock);
  client.previous_time = emscripten_get_now() * 0.001;
  emscripten_set_main_loop(frame, 0, EM_TRUE);
  return 0;
}
