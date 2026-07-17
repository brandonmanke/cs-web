#include "world.h"

#include "box3d/box3d.h"
#include "box3d/collision.h"

#include <cmath>

namespace cs {
namespace {

// Quake-style backoff: traces stop 1/32u short of surfaces so the hull never
// rests exactly on geometry and the next trace can't start inside it.
constexpr float kTraceBackoff = 0.03125F;

b3WorldId g_world = b3_nullWorldId;
b3BodyId g_body = b3_nullBodyId;

b3Pos to_pos(Vec3 v) { return {v.x, v.y, v.z}; }

b3ShapeDef make_shape_def(std::uint32_t material) {
  b3ShapeDef def = b3DefaultShapeDef();
  def.baseMaterial.userMaterialId = material;
  return def;
}

struct CastContext {
  float fraction = 1.0F;
  b3Vec3 normal = {0.0F, 0.0F, 0.0F};
  std::uint64_t material = 0;
  bool hit = false;
};

float closest_cast_callback(b3ShapeId, b3Pos, b3Vec3 normal, float fraction,
                            std::uint64_t material, int, int, void* context) {
  auto* ctx = static_cast<CastContext*>(context);
  ctx->hit = true;
  ctx->fraction = fraction;
  ctx->normal = normal;
  ctx->material = material;
  return fraction; // clip: keep closest
}

} // namespace

void world_create() {
  if (b3World_IsValid(g_world)) {
    return;
  }
  b3WorldDef def = b3DefaultWorldDef();
  def.gravity = {0.0F, 0.0F, 0.0F}; // query-only world, never stepped for dynamics
  def.enableSleep = false;
  g_world = b3CreateWorld(&def);
  b3BodyDef body_def = b3DefaultBodyDef();
  body_def.type = b3_staticBody;
  body_def.position = {0.0, 0.0, 0.0};
  g_body = b3CreateBody(g_world, &body_def);
}

void world_destroy() {
  if (b3World_IsValid(g_world)) {
    b3DestroyWorld(g_world);
    g_world = b3_nullWorldId;
    g_body = b3_nullBodyId;
  }
}

void world_reset() {
  world_destroy();
  world_create();
}

void world_add_box(Vec3 mins, Vec3 maxs, std::uint32_t material) {
  const b3Vec3 half = {(maxs.x - mins.x) * 0.5F, (maxs.y - mins.y) * 0.5F,
                       (maxs.z - mins.z) * 0.5F};
  const b3Vec3 center = {(maxs.x + mins.x) * 0.5F, (maxs.y + mins.y) * 0.5F,
                         (maxs.z + mins.z) * 0.5F};
  b3BoxHull box = b3MakeOffsetBoxHull(half.x, half.y, half.z, center);
  b3ShapeDef def = make_shape_def(material);
  b3CreateHullShape(g_body, &def, &box.base);
}

void world_add_hull(const float* points, std::uint32_t point_count, std::uint32_t material) {
  b3HullData* hull =
      b3CreateHull(reinterpret_cast<const b3Vec3*>(points), static_cast<int>(point_count),
                   static_cast<int>(point_count));
  if (hull == nullptr) {
    return;
  }
  b3ShapeDef def = make_shape_def(material);
  b3CreateHullShape(g_body, &def, hull);
  b3DestroyHull(hull);
}

bool world_add_mesh(const float* vertices, std::uint32_t vertex_count,
                    const std::uint32_t* indices, std::uint32_t triangle_count,
                    std::uint32_t material) {
  if (vertex_count < 3 || triangle_count < 1) {
    return false;
  }
  b3MeshDef def = {};
  def.vertices = const_cast<b3Vec3*>(reinterpret_cast<const b3Vec3*>(vertices));
  def.indices = const_cast<std::int32_t*>(reinterpret_cast<const std::int32_t*>(indices));
  def.vertexCount = static_cast<int>(vertex_count);
  def.triangleCount = static_cast<int>(triangle_count);
  def.weldVertices = true;
  def.weldTolerance = 0.1F;
  def.identifyEdges = true;
  b3MeshData* mesh = b3CreateMesh(&def, nullptr, 0);
  if (mesh == nullptr) {
    return false;
  }
  b3ShapeDef shape_def = make_shape_def(material);
  b3CreateMeshShape(g_body, &shape_def, mesh, {1.0F, 1.0F, 1.0F});
  b3DestroyMesh(mesh);
  return true;
}

void world_finalize() {
  b3World_RebuildStaticTree(g_world);
}

TraceResult world_trace_hull(Vec3 start, Vec3 end, Vec3 half) {
  TraceResult result = {1.0F, end, {0.0F, 0.0F, 0.0F}, 0, false};
  const b3Vec3 delta = {end.x - start.x, end.y - start.y, end.z - start.z};
  const float len =
      std::sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
  if (!b3World_IsValid(g_world) || len <= 0.0F) {
    return result;
  }
  const b3Vec3 points[8] = {
      {-half.x, -half.y, -half.z}, {half.x, -half.y, -half.z},
      {-half.x, half.y, -half.z},  {half.x, half.y, -half.z},
      {-half.x, -half.y, half.z},  {half.x, -half.y, half.z},
      {-half.x, half.y, half.z},   {half.x, half.y, half.z},
  };
  const b3ShapeProxy proxy = {points, 8, 0.0F};
  CastContext ctx;
  b3World_CastShape(g_world, to_pos(start), &proxy, delta, b3DefaultQueryFilter(),
                    closest_cast_callback, &ctx);
  if (!ctx.hit) {
    return result;
  }
  float fraction = ctx.fraction - kTraceBackoff / len;
  if (fraction < 0.0F) {
    fraction = 0.0F;
  }
  result.fraction = fraction;
  result.end = {start.x + delta.x * fraction, start.y + delta.y * fraction,
                start.z + delta.z * fraction};
  result.normal = {ctx.normal.x, ctx.normal.y, ctx.normal.z};
  result.material = static_cast<std::uint32_t>(ctx.material);
  result.hit = true;
  return result;
}

namespace {
bool overlap_found_callback(b3ShapeId, void* context) {
  *static_cast<bool*>(context) = true;
  return false; // first overlap is enough
}
} // namespace

bool world_overlap_hull(Vec3 center, Vec3 half) {
  if (!b3World_IsValid(g_world)) {
    return false;
  }
  const b3Vec3 points[8] = {
      {-half.x, -half.y, -half.z}, {half.x, -half.y, -half.z},
      {-half.x, half.y, -half.z},  {half.x, half.y, -half.z},
      {-half.x, -half.y, half.z},  {half.x, -half.y, half.z},
      {-half.x, half.y, half.z},   {half.x, half.y, half.z},
  };
  const b3ShapeProxy proxy = {points, 8, 0.0F};
  bool found = false;
  b3World_OverlapShape(g_world, to_pos(center), &proxy, b3DefaultQueryFilter(),
                       overlap_found_callback, &found);
  return found;
}

TraceResult world_trace_ray(Vec3 start, Vec3 end) {
  TraceResult result = {1.0F, end, {0.0F, 0.0F, 0.0F}, 0, false};
  if (!b3World_IsValid(g_world)) {
    return result;
  }
  const b3Vec3 delta = {end.x - start.x, end.y - start.y, end.z - start.z};
  const b3RayResult ray =
      b3World_CastRayClosest(g_world, to_pos(start), delta, b3DefaultQueryFilter());
  if (!ray.hit) {
    return result;
  }
  result.fraction = ray.fraction;
  result.end = {static_cast<float>(ray.point.x), static_cast<float>(ray.point.y),
                static_cast<float>(ray.point.z)};
  result.normal = {ray.normal.x, ray.normal.y, ray.normal.z};
  result.material = static_cast<std::uint32_t>(ray.userMaterialId);
  result.hit = true;
  return result;
}

} // namespace cs
