#include "cs/sim.h"

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
  const float pitch_cosine = std::cos(client.pitch);
  const Vec3 view_direction{
    std::sin(client.yaw) * pitch_cosine,
    std::sin(client.pitch),
    -std::cos(client.yaw) * pitch_cosine,
  };
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
  draw_crosshair();
}

EM_BOOL on_key(int event_type, const EmscriptenKeyboardEvent* event, void*) {
  const bool down = event_type == EMSCRIPTEN_EVENT_KEYDOWN;
  bool* key = nullptr;
  if (std::strcmp(event->code, "KeyW") == 0) key = &client.input.forward;
  if (std::strcmp(event->code, "KeyS") == 0) key = &client.input.back;
  if (std::strcmp(event->code, "KeyA") == 0) key = &client.input.left;
  if (std::strcmp(event->code, "KeyD") == 0) key = &client.input.right;
  if (std::strcmp(event->code, "Space") == 0) key = &client.input.jump;
  if (
    std::strcmp(event->code, "ControlLeft") == 0 ||
    std::strcmp(event->code, "ControlRight") == 0 ||
    std::strcmp(event->code, "KeyC") == 0
  ) key = &client.input.duck;
  if (key == nullptr) return EM_FALSE;
  *key = down;
  return EM_TRUE;
}

EM_BOOL on_click(int, const EmscriptenMouseEvent*, void*) {
  emscripten_request_pointerlock("#canvas", EM_FALSE);
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
  client.yaw -= static_cast<float>(event->movementX) * sensitivity;
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
    const cs::InputCommand command{
      .forward = forward,
      .strafe = strafe,
      .yaw = client.yaw,
      .buttons = buttons,
    };
    sim_step(&command);
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
  emscripten_set_click_callback("#canvas", nullptr, EM_TRUE, on_click);
  emscripten_set_mousemove_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_mouse_move);
  emscripten_set_pointerlockchange_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, nullptr, EM_TRUE, on_pointer_lock);
  client.previous_time = emscripten_get_now() * 0.001;
  emscripten_set_main_loop(frame, 0, EM_TRUE);
  return 0;
}
