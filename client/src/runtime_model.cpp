#include "runtime_model.h"

#define CGLTF_IMPLEMENTATION
#include <cgltf.h>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#include <stb_image.h>

#include <algorithm>
#include <array>
#include <cfloat>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace cs::client {
namespace {

struct ModelVertex {
  float position[3];
  float color[3];
  float uv[2];
};

void transform_point(const float matrix[16], float point[3]) {
  const std::array<float, 3> source{point[0], point[1], point[2]};
  for (int row = 0; row < 3; ++row) {
    point[row] =
      matrix[row] * source[0] +
      matrix[4 + row] * source[1] +
      matrix[8 + row] * source[2] +
      matrix[12 + row];
  }
}

const cgltf_accessor* find_attribute(
  const cgltf_primitive& primitive,
  cgltf_attribute_type type
) {
  for (cgltf_size index = 0; index < primitive.attributes_count; ++index) {
    if (primitive.attributes[index].type == type) {
      return primitive.attributes[index].data;
    }
  }
  return nullptr;
}

const cgltf_image* surface_image(
  const cgltf_data& data,
  const cgltf_primitive& primitive
) {
  if (
    primitive.material != nullptr &&
    primitive.material->has_pbr_metallic_roughness &&
    primitive.material->pbr_metallic_roughness.base_color_texture.texture != nullptr
  ) {
    return primitive.material->pbr_metallic_roughness.base_color_texture.texture->image;
  }
  return data.images_count > 0 ? &data.images[0] : nullptr;
}

bool upload_texture(const cgltf_image* image, GLuint& texture) {
  if (
    image == nullptr ||
    image->buffer_view == nullptr ||
    image->buffer_view->buffer == nullptr ||
    image->buffer_view->buffer->data == nullptr
  ) {
    return false;
  }

  const auto* encoded = static_cast<const stbi_uc*>(image->buffer_view->buffer->data) +
    image->buffer_view->offset;
  int width = 0;
  int height = 0;
  int channels = 0;
  // glTF maps (0, 0) to the image's first, upper-left texel. Preserve the
  // encoded row order; flipping here would invert standards-compliant assets.
  stbi_set_flip_vertically_on_load(0);
  stbi_uc* pixels = stbi_load_from_memory(
    encoded,
    static_cast<int>(image->buffer_view->size),
    &width,
    &height,
    &channels,
    STBI_rgb_alpha
  );
  if (pixels == nullptr) return false;

  glGenTextures(1, &texture);
  glBindTexture(GL_TEXTURE_2D, texture);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(
    GL_TEXTURE_2D,
    0,
    GL_RGBA,
    width,
    height,
    0,
    GL_RGBA,
    GL_UNSIGNED_BYTE,
    pixels
  );
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
  glGenerateMipmap(GL_TEXTURE_2D);
  stbi_image_free(pixels);
  return true;
}

}  // namespace

bool load_glb_model(const char* path, RuntimeModel& model) {
  cgltf_options options{};
  cgltf_data* data = nullptr;
  if (cgltf_parse_file(&options, path, &data) != cgltf_result_success) {
    std::fprintf(stderr, "unable to parse GLB: %s\n", path);
    return false;
  }
  if (cgltf_load_buffers(&options, data, path) != cgltf_result_success) {
    std::fprintf(stderr, "unable to load GLB buffers: %s\n", path);
    cgltf_free(data);
    return false;
  }

  std::vector<ModelVertex> vertices;
  std::vector<std::uint32_t> indices;
  struct SurfaceSource {
    const cgltf_image* image;
    std::uint32_t first_index;
    std::uint32_t index_count;
  };
  std::vector<SurfaceSource> surfaces;
  std::array<float, 3> minimum{FLT_MAX, FLT_MAX, FLT_MAX};
  std::array<float, 3> maximum{-FLT_MAX, -FLT_MAX, -FLT_MAX};

  for (cgltf_size node_index = 0; node_index < data->nodes_count; ++node_index) {
    const cgltf_node& node = data->nodes[node_index];
    if (node.mesh == nullptr) continue;
    float world[16]{};
    cgltf_node_transform_world(&node, world);

    for (cgltf_size primitive_index = 0; primitive_index < node.mesh->primitives_count; ++primitive_index) {
      const cgltf_primitive& primitive = node.mesh->primitives[primitive_index];
      if (primitive.type != cgltf_primitive_type_triangles) continue;
      const cgltf_accessor* positions = find_attribute(primitive, cgltf_attribute_type_position);
      const cgltf_accessor* texture_coordinates = find_attribute(primitive, cgltf_attribute_type_texcoord);
      if (positions == nullptr) continue;

      const std::uint32_t first_vertex = static_cast<std::uint32_t>(vertices.size());
      vertices.reserve(vertices.size() + positions->count);
      for (cgltf_size vertex_index = 0; vertex_index < positions->count; ++vertex_index) {
        ModelVertex vertex{
          .position = {0.0F, 0.0F, 0.0F},
          .color = {1.0F, 1.0F, 1.0F},
          .uv = {0.0F, 0.0F},
        };
        cgltf_accessor_read_float(positions, vertex_index, vertex.position, 3);
        transform_point(world, vertex.position);
        if (texture_coordinates != nullptr) {
          cgltf_accessor_read_float(texture_coordinates, vertex_index, vertex.uv, 2);
        }
        for (int axis = 0; axis < 3; ++axis) {
          minimum[axis] = std::min(minimum[axis], vertex.position[axis]);
          maximum[axis] = std::max(maximum[axis], vertex.position[axis]);
        }
        vertices.push_back(vertex);
      }

      const cgltf_size index_count = primitive.indices != nullptr
        ? primitive.indices->count
        : positions->count;
      const std::uint32_t first_index = static_cast<std::uint32_t>(indices.size());
      indices.reserve(indices.size() + index_count);
      for (cgltf_size index = 0; index < index_count; ++index) {
        const cgltf_size source_index = primitive.indices != nullptr
          ? cgltf_accessor_read_index(primitive.indices, index)
          : index;
        indices.push_back(first_vertex + static_cast<std::uint32_t>(source_index));
      }
      surfaces.push_back({
        .image = surface_image(*data, primitive),
        .first_index = first_index,
        .index_count = static_cast<std::uint32_t>(index_count),
      });
    }
  }

  const bool has_geometry = !vertices.empty() && !indices.empty();
  if (!has_geometry || surfaces.size() > RuntimeModel::kMaxSurfaces) {
    std::fprintf(stderr, "GLB has no triangle geometry or too many surfaces: %s\n", path);
    cgltf_free(data);
    return false;
  }

  struct UploadedImage {
    const cgltf_image* image;
    GLuint texture;
  };
  std::array<UploadedImage, RuntimeModel::kMaxSurfaces> uploaded{};
  std::size_t uploaded_count = 0;
  bool has_textures = true;
  for (std::size_t index = 0; index < surfaces.size(); ++index) {
    GLuint texture = 0;
    for (std::size_t image_index = 0; image_index < uploaded_count; ++image_index) {
      if (uploaded[image_index].image == surfaces[index].image) {
        texture = uploaded[image_index].texture;
        break;
      }
    }
    if (texture == 0) {
      has_textures = upload_texture(surfaces[index].image, texture);
      if (!has_textures) break;
      uploaded[uploaded_count++] = {surfaces[index].image, texture};
    }
    model.surfaces[index] = {
      .texture = texture,
      .index_count = static_cast<GLsizei>(surfaces[index].index_count),
      .first_index = surfaces[index].first_index,
    };
  }
  cgltf_free(data);
  if (!has_textures) {
    std::fprintf(stderr, "GLB is missing an embedded PNG/JPEG texture: %s\n", path);
    return false;
  }

  glGenVertexArrays(1, &model.vao);
  glBindVertexArray(model.vao);
  glGenBuffers(1, &model.vertex_buffer);
  glBindBuffer(GL_ARRAY_BUFFER, model.vertex_buffer);
  glBufferData(
    GL_ARRAY_BUFFER,
    static_cast<GLsizeiptr>(vertices.size() * sizeof(ModelVertex)),
    vertices.data(),
    GL_STATIC_DRAW
  );
  glGenBuffers(1, &model.index_buffer);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, model.index_buffer);
  glBufferData(
    GL_ELEMENT_ARRAY_BUFFER,
    static_cast<GLsizeiptr>(indices.size() * sizeof(std::uint32_t)),
    indices.data(),
    GL_STATIC_DRAW
  );
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(ModelVertex), nullptr);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(
    1,
    3,
    GL_FLOAT,
    GL_FALSE,
    sizeof(ModelVertex),
    reinterpret_cast<const void*>(3 * sizeof(float))
  );
  glEnableVertexAttribArray(2);
  glVertexAttribPointer(
    2,
    2,
    GL_FLOAT,
    GL_FALSE,
    sizeof(ModelVertex),
    reinterpret_cast<const void*>(6 * sizeof(float))
  );

  model.index_count = static_cast<GLsizei>(indices.size());
  model.surface_count = static_cast<std::uint32_t>(surfaces.size());
  for (int axis = 0; axis < 3; ++axis) {
    model.minimum[axis] = minimum[axis];
    model.maximum[axis] = maximum[axis];
  }
  std::fprintf(
    stdout,
    "loaded %s: %zu vertices, %zu indices\n",
    path,
    vertices.size(),
    indices.size()
  );
  return true;
}

void draw_model(const RuntimeModel& model) {
  glBindVertexArray(model.vao);
  for (std::uint32_t index = 0; index < model.surface_count; ++index) {
    const RuntimeSurface& surface = model.surfaces[index];
    glBindTexture(GL_TEXTURE_2D, surface.texture);
    glDrawElements(
      GL_TRIANGLES,
      surface.index_count,
      GL_UNSIGNED_INT,
      reinterpret_cast<const void*>(
        static_cast<std::uintptr_t>(surface.first_index * sizeof(std::uint32_t))
      )
    );
  }
}

}  // namespace cs::client
