#include "world.h"

#include <cmath>

// Convex-brush collision, the GoldSrc/Quake model.
//
// The world is a set of convex brushes, each the intersection of a few
// halfspaces. A swept AABB is traced by pushing every brush plane outward by
// the hull's support along that plane's normal (a Minkowski sum), which turns
// the swept-box query into a ray-vs-convex-polytope clip -- the same reduction
// Quake's CM_ClipBoxToBrush uses.
//
// Because brushes are sealed and their planes point outward by construction,
// "which side am I on" is never ambiguous. The one-sided display-mesh case that
// forced backface rejection here (see FINDINGS.md) simply cannot arise.

namespace cs {
namespace {

// Traces stop 1/32u short of surfaces so the hull never rests exactly on
// geometry and the next trace can't start inside it.
constexpr float kTraceBackoff = 0.03125F;

constexpr std::uint32_t kMaxBrushes = 4096;
constexpr std::uint32_t kMaxPlanes = 32768;
constexpr std::uint32_t kMaxPlanesPerBrush = 64;

// Slack when deciding whether a candidate corner lies inside every plane.
constexpr float kOnPlaneEpsilon = 0.01F;

struct Plane {
  Vec3 n;  // unit normal, pointing out of the brush
  float d; // interior halfspace is dot(n, x) <= d
};

struct Brush {
  std::uint32_t first_plane;
  std::uint32_t plane_count;
  Vec3 mins;
  Vec3 maxs;
  std::uint32_t material;
};

Plane g_planes[kMaxPlanes];
Brush g_brushes[kMaxBrushes];
std::uint32_t g_plane_count;
std::uint32_t g_brush_count;

float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

Vec3 cross(Vec3 a, Vec3 b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

// Corner enumeration: every triple of planes meets at a point; the ones that
// satisfy all the brush's other halfspaces are its vertices. Gives the AABB for
// broadphase and rejects degenerate/unbounded brushes in one pass.
bool compute_bounds(const Plane* planes, std::uint32_t count, Vec3& mins, Vec3& maxs) {
  mins = {1e30F, 1e30F, 1e30F};
  maxs = {-1e30F, -1e30F, -1e30F};
  bool found = false;

  for (std::uint32_t i = 0; i < count; ++i) {
    for (std::uint32_t j = i + 1; j < count; ++j) {
      for (std::uint32_t k = j + 1; k < count; ++k) {
        const Vec3 n0 = planes[i].n;
        const Vec3 n1 = planes[j].n;
        const Vec3 n2 = planes[k].n;
        const Vec3 c12 = cross(n1, n2);
        const float den = dot(n0, c12);
        if (den > -1e-6F && den < 1e-6F) {
          continue; // the three planes share a direction; no single corner
        }
        const Vec3 c20 = cross(n2, n0);
        const Vec3 c01 = cross(n0, n1);
        const float inv = 1.0F / den;
        const Vec3 point = {
            (planes[i].d * c12.x + planes[j].d * c20.x + planes[k].d * c01.x) * inv,
            (planes[i].d * c12.y + planes[j].d * c20.y + planes[k].d * c01.y) * inv,
            (planes[i].d * c12.z + planes[j].d * c20.z + planes[k].d * c01.z) * inv,
        };

        bool inside = true;
        for (std::uint32_t m = 0; m < count; ++m) {
          if (dot(planes[m].n, point) - planes[m].d > kOnPlaneEpsilon) {
            inside = false;
            break;
          }
        }
        if (!inside) {
          continue;
        }

        found = true;
        if (point.x < mins.x) mins.x = point.x;
        if (point.y < mins.y) mins.y = point.y;
        if (point.z < mins.z) mins.z = point.z;
        if (point.x > maxs.x) maxs.x = point.x;
        if (point.y > maxs.y) maxs.y = point.y;
        if (point.z > maxs.z) maxs.z = point.z;
      }
    }
  }
  return found;
}

// Axial bevels (Quake's CM_AddBrushBevels). Expanding only the brush's own
// planes over-approximates the Minkowski sum near corners, so a box hull can
// snag on a sloped brush's edge. Adding the six AABB planes removes the common
// cases; a box brush already has them, so this is a no-op there.
void add_axial_bevels(Brush& brush) {
  const float* mins = &brush.mins.x;
  const float* maxs = &brush.maxs.x;

  for (int axis = 0; axis < 3; ++axis) {
    for (int sign = 0; sign < 2; ++sign) {
      Vec3 normal = {0.0F, 0.0F, 0.0F};
      float* n = &normal.x;
      n[axis] = sign == 0 ? 1.0F : -1.0F;
      const float distance = sign == 0 ? maxs[axis] : -mins[axis];

      bool present = false;
      for (std::uint32_t i = 0; i < brush.plane_count; ++i) {
        if (dot(g_planes[brush.first_plane + i].n, normal) > 0.999F) {
          present = true;
          break;
        }
      }
      if (present || brush.plane_count >= kMaxPlanesPerBrush ||
          g_plane_count >= kMaxPlanes) {
        continue;
      }
      // Bevels append to the brush's run, which is still the tail of g_planes.
      g_planes[g_plane_count] = {normal, distance};
      ++g_plane_count;
      ++brush.plane_count;
    }
  }
}

// Ray-vs-expanded-convex-polytope clip. Tracks the last plane crossed going in
// (enter) against the first crossed going out (leave); if they cross in order,
// the segment pierces the brush.
//
// A hull that starts inside the brush is skipped rather than reported as a
// zero-fraction hit: pmove resolves embedding through unstick()/overlap tests,
// and returning a blocking hit here would stall slide_move instead.
void clip_hull_to_brush(const Brush& brush, Vec3 start, Vec3 delta, Vec3 half,
                        float& best_fraction, float& best_exit, Vec3& best_normal,
                        std::uint32_t& best_material, bool& hit) {
  float enter_fraction = -1.0F;
  float leave_fraction = 1.0F;
  Vec3 enter_normal = {0.0F, 0.0F, 0.0F};
  bool starts_outside = false;

  for (std::uint32_t i = 0; i < brush.plane_count; ++i) {
    const Plane& plane = g_planes[brush.first_plane + i];
    // Support of the box along this normal: expands the plane outward so the
    // swept box collapses to a swept point.
    const float offset = std::fabs(plane.n.x) * half.x +
                         std::fabs(plane.n.y) * half.y +
                         std::fabs(plane.n.z) * half.z;
    const float distance = plane.d + offset;

    const float d1 = dot(plane.n, start) - distance;
    const float d2 = dot(plane.n, {start.x + delta.x, start.y + delta.y,
                                   start.z + delta.z}) -
                     distance;

    if (d1 > 0.0F) {
      starts_outside = true;
    }
    if (d1 > 0.0F && d2 >= d1) {
      return; // outside this plane and not closing on it: brush can't be hit
    }
    if (d1 <= 0.0F && d2 <= 0.0F) {
      continue; // stays behind this plane for the whole move
    }

    const float denominator = d1 - d2;
    if (denominator > -1e-9F && denominator < 1e-9F) {
      continue;
    }
    const float fraction = d1 / denominator;
    if (d1 > d2) {
      if (fraction > enter_fraction) {
        enter_fraction = fraction;
        enter_normal = plane.n;
      }
    } else {
      if (fraction < leave_fraction) {
        leave_fraction = fraction;
      }
    }
  }

  if (!starts_outside) {
    return; // started solid; see note above
  }
  if (enter_fraction < 0.0F || enter_fraction >= leave_fraction) {
    return;
  }
  if (enter_fraction >= best_fraction) {
    return;
  }
  best_fraction = enter_fraction;
  // The same clip already knows the far side, so thickness is free. Nothing in
  // movement reads it; penetration would otherwise need a second query per wall.
  best_exit = leave_fraction;
  best_normal = enter_normal;
  best_material = brush.material;
  hit = true;
}

bool bounds_overlap(const Brush& brush, Vec3 mins, Vec3 maxs) {
  return !(mins.x > brush.maxs.x || maxs.x < brush.mins.x ||
           mins.y > brush.maxs.y || maxs.y < brush.mins.y ||
           mins.z > brush.maxs.z || maxs.z < brush.mins.z);
}

} // namespace

void world_create() { world_reset(); }

void world_destroy() {
  g_plane_count = 0;
  g_brush_count = 0;
}

void world_reset() {
  g_plane_count = 0;
  g_brush_count = 0;
}

void world_add_box(Vec3 mins, Vec3 maxs, std::uint32_t material) {
  if (g_brush_count >= kMaxBrushes || g_plane_count + 6 > kMaxPlanes) {
    return;
  }
  Brush& brush = g_brushes[g_brush_count];
  brush.first_plane = g_plane_count;
  brush.plane_count = 6;
  brush.mins = mins;
  brush.maxs = maxs;
  brush.material = material;

  g_planes[g_plane_count + 0] = {{1.0F, 0.0F, 0.0F}, maxs.x};
  g_planes[g_plane_count + 1] = {{-1.0F, 0.0F, 0.0F}, -mins.x};
  g_planes[g_plane_count + 2] = {{0.0F, 1.0F, 0.0F}, maxs.y};
  g_planes[g_plane_count + 3] = {{0.0F, -1.0F, 0.0F}, -mins.y};
  g_planes[g_plane_count + 4] = {{0.0F, 0.0F, 1.0F}, maxs.z};
  g_planes[g_plane_count + 5] = {{0.0F, 0.0F, -1.0F}, -mins.z};
  g_plane_count += 6;
  ++g_brush_count;
}

bool world_add_brush(const float* planes, std::uint32_t plane_count,
                     std::uint32_t material) {
  if (planes == nullptr || plane_count < 4 || plane_count > kMaxPlanesPerBrush) {
    return false;
  }
  if (g_brush_count >= kMaxBrushes || g_plane_count + plane_count > kMaxPlanes) {
    return false;
  }

  Plane normalized[kMaxPlanesPerBrush];
  for (std::uint32_t i = 0; i < plane_count; ++i) {
    Vec3 n = {planes[i * 4 + 0], planes[i * 4 + 1], planes[i * 4 + 2]};
    float d = planes[i * 4 + 3];
    const float length = std::sqrt(dot(n, n));
    if (length < 1e-6F) {
      return false;
    }
    const float inv = 1.0F / length;
    normalized[i] = {{n.x * inv, n.y * inv, n.z * inv}, d * inv};
  }

  Vec3 mins;
  Vec3 maxs;
  if (!compute_bounds(normalized, plane_count, mins, maxs)) {
    return false; // degenerate or unbounded
  }

  Brush& brush = g_brushes[g_brush_count];
  brush.first_plane = g_plane_count;
  brush.plane_count = plane_count;
  brush.mins = mins;
  brush.maxs = maxs;
  brush.material = material;
  for (std::uint32_t i = 0; i < plane_count; ++i) {
    g_planes[g_plane_count + i] = normalized[i];
  }
  g_plane_count += plane_count;
  add_axial_bevels(brush);
  ++g_brush_count;
  return true;
}

void world_finalize() {
  // Brushes are traced by linear scan with an AABB reject. At a few thousand
  // brushes and a handful of traces per tick that is well under budget; add a
  // spatial index here if a map ever makes it show up in a profile.
}

TraceResult world_trace_hull(Vec3 start, Vec3 end, Vec3 half) {
  TraceResult result = {1.0F, 1.0F, end, {0.0F, 0.0F, 0.0F}, 0, false};
  const Vec3 delta = {end.x - start.x, end.y - start.y, end.z - start.z};
  const float length = std::sqrt(dot(delta, delta));
  if (length <= 0.0F) {
    return result;
  }

  const Vec3 sweep_mins = {
      (start.x < end.x ? start.x : end.x) - half.x,
      (start.y < end.y ? start.y : end.y) - half.y,
      (start.z < end.z ? start.z : end.z) - half.z,
  };
  const Vec3 sweep_maxs = {
      (start.x > end.x ? start.x : end.x) + half.x,
      (start.y > end.y ? start.y : end.y) + half.y,
      (start.z > end.z ? start.z : end.z) + half.z,
  };

  float fraction = 1.0F;
  float exit_fraction = 1.0F;
  Vec3 normal = {0.0F, 0.0F, 0.0F};
  std::uint32_t material = 0;
  bool hit = false;
  for (std::uint32_t i = 0; i < g_brush_count; ++i) {
    const Brush& brush = g_brushes[i];
    if (!bounds_overlap(brush, sweep_mins, sweep_maxs)) {
      continue;
    }
    clip_hull_to_brush(brush, start, delta, half, fraction, exit_fraction, normal,
                       material, hit);
  }
  if (!hit) {
    return result;
  }

  fraction -= kTraceBackoff / length;
  if (fraction < 0.0F) {
    fraction = 0.0F;
  }
  result.fraction = fraction;
  result.exit_fraction = exit_fraction;
  result.end = {start.x + delta.x * fraction, start.y + delta.y * fraction,
                start.z + delta.z * fraction};
  result.normal = normal;
  result.material = material;
  result.hit = true;
  return result;
}

TraceResult world_trace_ray(Vec3 start, Vec3 end) {
  TraceResult result = {1.0F, 1.0F, end, {0.0F, 0.0F, 0.0F}, 0, false};
  const Vec3 delta = {end.x - start.x, end.y - start.y, end.z - start.z};
  if (dot(delta, delta) <= 0.0F) {
    return result;
  }

  const Vec3 sweep_mins = {start.x < end.x ? start.x : end.x,
                           start.y < end.y ? start.y : end.y,
                           start.z < end.z ? start.z : end.z};
  const Vec3 sweep_maxs = {start.x > end.x ? start.x : end.x,
                           start.y > end.y ? start.y : end.y,
                           start.z > end.z ? start.z : end.z};

  float fraction = 1.0F;
  float exit_fraction = 1.0F;
  Vec3 normal = {0.0F, 0.0F, 0.0F};
  std::uint32_t material = 0;
  bool hit = false;
  const Vec3 point_half = {0.0F, 0.0F, 0.0F};
  for (std::uint32_t i = 0; i < g_brush_count; ++i) {
    const Brush& brush = g_brushes[i];
    if (!bounds_overlap(brush, sweep_mins, sweep_maxs)) {
      continue;
    }
    clip_hull_to_brush(brush, start, delta, point_half, fraction, exit_fraction,
                       normal, material, hit);
  }
  if (!hit) {
    return result;
  }
  result.fraction = fraction;
  result.exit_fraction = exit_fraction;
  result.end = {start.x + delta.x * fraction, start.y + delta.y * fraction,
                start.z + delta.z * fraction};
  result.normal = normal;
  result.material = material;
  result.hit = true;
  return result;
}

bool world_overlap_hull(Vec3 center, Vec3 half) {
  const Vec3 mins = {center.x - half.x, center.y - half.y, center.z - half.z};
  const Vec3 maxs = {center.x + half.x, center.y + half.y, center.z + half.z};

  for (std::uint32_t i = 0; i < g_brush_count; ++i) {
    const Brush& brush = g_brushes[i];
    if (!bounds_overlap(brush, mins, maxs)) {
      continue;
    }
    // The expanded brush contains the hull centre exactly when the hull and the
    // brush intersect (axial bevels keep this tight for sloped brushes).
    bool inside = true;
    for (std::uint32_t j = 0; j < brush.plane_count; ++j) {
      const Plane& plane = g_planes[brush.first_plane + j];
      const float offset = std::fabs(plane.n.x) * half.x +
                           std::fabs(plane.n.y) * half.y +
                           std::fabs(plane.n.z) * half.z;
      if (dot(plane.n, center) - (plane.d + offset) > 0.0F) {
        inside = false;
        break;
      }
    }
    if (inside) {
      return true;
    }
  }
  return false;
}

} // namespace cs
