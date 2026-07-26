#pragma once

#include "cs/sim.h"

// Static collision world of sealed convex brushes (GoldSrc/Quake model).
// The player is kinematic; this only answers sweep/ray/overlap queries.

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
// planes: (nx, ny, nz, d) quads; interior is dot(n, x) <= d. Must be a bounded
// convex solid. Returns false on degenerate/unbounded input.
bool world_add_brush(const float* planes, std::uint32_t plane_count,
                     std::uint32_t material);
void world_finalize();

// Sweep an axis-aligned box of half extents `half` from start to end.
TraceResult world_trace_hull(Vec3 start, Vec3 end, Vec3 half);
TraceResult world_trace_ray(Vec3 start, Vec3 end);
// True if a box of half extents `half` centered at `center` intersects the world.
bool world_overlap_hull(Vec3 center, Vec3 half);

} // namespace cs
