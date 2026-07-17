#pragma once

#include "cs/sim.h"

// Static collision world backed by box3d. The sim owns kinematic movement;
// box3d only answers sweep/ray queries, so it stays swappable.

namespace cs {

struct TraceResult {
  float fraction; // of the requested move, after epsilon backoff
  Vec3 end;
  Vec3 normal;
  std::uint32_t material;
  bool hit;
};

void world_create();
void world_destroy();
void world_reset();
void world_add_box(Vec3 mins, Vec3 maxs, std::uint32_t material);
void world_add_hull(const float* points, std::uint32_t point_count, std::uint32_t material);
bool world_add_mesh(const float* vertices, std::uint32_t vertex_count,
                    const std::uint32_t* indices, std::uint32_t triangle_count,
                    std::uint32_t material);
void world_finalize();

// Sweep an axis-aligned box of half extents `half` from start to end.
TraceResult world_trace_hull(Vec3 start, Vec3 end, Vec3 half);
TraceResult world_trace_ray(Vec3 start, Vec3 end);
// True if a box of half extents `half` centered at `center` intersects the world.
bool world_overlap_hull(Vec3 center, Vec3 half);

} // namespace cs
