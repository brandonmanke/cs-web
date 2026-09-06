#include "nav.h"
#include "world.h"

#include <cmath>

namespace cs {
namespace {

constexpr int kMaxNodes = 4096;
constexpr int kBuckets = 8192;
constexpr float kSpacing = 64.0F;
constexpr Vec3 kHull = {kHullHalfWidth, kHullHalfHeightStand, kHullHalfWidth};
constexpr int kDirections[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1},
                                  {1, 1}, {-1, 1}, {1, -1}, {-1, -1}};
struct Node {
  Vec3 origin;
  int x, z, bucket_next;
  int links[8];
};
Node g_nodes[kMaxNodes];
int g_heads[kBuckets];
int g_count;
bool g_built;
// Scratch for one breadth-first search; bots plan sequentially on the sim tick.
int g_queue[kMaxNodes], g_parent[kMaxNodes];

float distance2(Vec3 a, Vec3 b) {
  const float x = a.x - b.x, y = a.y - b.y, z = a.z - b.z;
  return x * x + y * y + z * z;
}

// Sample support in small steps with the standing hull. Raising the query by
// one legal step admits stairs/slopes; a down trace rejects gaps, tall steps,
// steep ground and low ceilings. This builds routes, never moves a player.
bool walk(Vec3 from, float x, float z, Vec3& out) {
  const float dx = x - from.x, dz = z - from.z;
  const int steps = static_cast<int>(std::ceil(std::sqrt(dx * dx + dz * dz) / 8.0F));
  out = from;
  if (world_overlap_hull(from, kHull)) return false;
  for (int step = 1; step <= steps; ++step) {
    const float t = static_cast<float>(step) / static_cast<float>(steps);
    const Vec3 up = {out.x, out.y + kStepHeight, out.z};
    const TraceResult lift = world_trace_hull(out, up, kHull);
    const Vec3 across = {from.x + dx * t, lift.end.y, from.z + dz * t};
    if (world_trace_hull(lift.end, across, kHull).hit) return false;
    const Vec3 down = {across.x, out.y - kStepHeight - 0.1F, across.z};
    const TraceResult floor = world_trace_hull(across, down, kHull);
    if (!floor.hit || floor.normal.y < kGroundNormalMinY) return false;
    out = floor.end;
    if (world_overlap_hull(out, kHull)) return false;
  }
  return true;
}

int insert(Vec3 at) {
  const int x = static_cast<int>(std::lround(at.x / kSpacing));
  const int z = static_cast<int>(std::lround(at.z / kSpacing));
  const unsigned bucket = (static_cast<unsigned>(x) * 73856093U ^
                           static_cast<unsigned>(z) * 19349663U) & (kBuckets - 1U);
  for (int i = g_heads[bucket]; i >= 0; i = g_nodes[i].bucket_next) {
    const Node& n = g_nodes[i];
    if (n.x == x && n.z == z && std::fabs(n.origin.y - at.y) < 4.0F) return i;
  }
  if (g_count == kMaxNodes) return -1;
  const int index = g_count++;
  Node& n = g_nodes[index];
  n.origin = at;
  n.x = x; n.z = z; n.bucket_next = g_heads[bucket];
  for (int& link : n.links) link = -1;
  g_heads[bucket] = index;
  return index;
}

void seed(Vec3 at) {
  const Vec3 bottom = {at.x, at.y - 128.0F, at.z};
  const TraceResult floor = world_trace_hull(at, bottom, kHull);
  if (!floor.hit || floor.normal.y < kGroundNormalMinY) return;
  Vec3 aligned;
  if (walk(floor.end, std::round(at.x / kSpacing) * kSpacing,
           std::round(at.z / kSpacing) * kSpacing, aligned)) insert(aligned);
}

int nearest(Vec3 at) {
  int best = -1;
  float score = 128.0F * 128.0F;
  for (int i = 0; i < g_count; ++i) {
    const Vec3 point = g_nodes[i].origin;
    const float d = distance2(at, point);
    Vec3 end;
    if (d < score && walk(at, point.x, point.z, end) && std::fabs(end.y - point.y) < 4.0F) {
      best = i; score = d;
    }
  }
  return best;
}

int search(int start) {
  for (int i = 0; i < g_count; ++i) g_parent[i] = -1;
  if (start < 0) return 0;
  int count = 1;
  g_queue[0] = start;
  g_parent[start] = start;
  for (int cursor = 0; cursor < count; ++cursor) {
    const int current = g_queue[cursor];
    for (const int next : g_nodes[current].links) {
      if (next < 0 || g_parent[next] >= 0) continue;
      g_parent[next] = current;
      g_queue[count++] = next;
    }
  }
  return count;
}

bool route(BotState& bot, int start, int goal) {
  bot.path_count = bot.path_cursor = 0;
  if (start < 0 || goal < 0 || g_parent[goal] < 0) return false;
  int count = 0;
  for (int node = goal; node != start; node = g_parent[node]) g_queue[count++] = node;
  // Include the start node: cutting straight to its successor can clip a corner.
  g_queue[count++] = start;
  while (count > 0 && bot.path_count < kMaxBotPath) {
    bot.path[bot.path_count++] = static_cast<std::uint32_t>(g_queue[--count]);
  }
  bot.goal = g_nodes[goal].origin;
  return true;
}

} // namespace

void nav_reset() { g_count = 0; g_built = false; }

void nav_build(const SimState& s) {
  if (g_built) return;
  g_built = true;
  for (int& head : g_heads) head = -1;
  for (std::uint32_t i = 0; i < s.spawn_count; ++i) seed(s.spawns[i].origin);
  for (std::uint32_t i = 0; i < s.player_count; ++i) seed(s.players[i].move.origin);
  for (int i = 0; i < g_count; ++i) {
    for (int d = 0; d < 8; ++d) {
      const Node& n = g_nodes[i];
      Vec3 end;
      if (walk(n.origin, (n.x + kDirections[d][0]) * kSpacing,
               (n.z + kDirections[d][1]) * kSpacing, end)) {
        g_nodes[i].links[d] = insert(end);
      }
    }
  }
}

bool nav_plan(SimState& s, std::uint32_t index, bool roam) {
  PlayerEntity& e = s.players[index];
  const Vec3 feet = feet_of(e);
  const int start = nearest({feet.x, feet.y + kHullHalfHeightStand, feet.z});
  const int count = search(start);
  if (count == 0) { e.bot.path_count = e.bot.path_cursor = 0; return false; }
  const int goal = roam ? g_queue[rand_below(s, static_cast<unsigned>(count))] : nearest(e.bot.goal);
  return route(e.bot, start, goal);
}

bool nav_cover(SimState& s, std::uint32_t index, Vec3 threat) {
  PlayerEntity& e = s.players[index];
  const Vec3 feet = feet_of(e);
  const int start = nearest({feet.x, feet.y + kHullHalfHeightStand, feet.z});
  const int count = search(start);
  int best = -1;
  float score = 384.0F * 384.0F;
  for (int i = 0; i < count; ++i) {
    const int node = g_queue[i];
    const Vec3 at = g_nodes[node].origin;
    const float distance = distance2(at, e.move.origin);
    // Crouched head height, not a floor ray: cover must hide the actual player.
    if (distance < score && world_trace_ray(threat, {at.x, at.y, at.z}).hit) {
      score = distance; best = node;
    }
  }
  return best >= 0 && route(e.bot, start, best);
}

bool nav_waypoint(PlayerEntity& e, Vec3& point) {
  BotState& bot = e.bot;
  const Vec3 feet = feet_of(e);
  while (bot.path_cursor < bot.path_count) {
    point = g_nodes[bot.path[bot.path_cursor]].origin;
    const float dx = point.x - feet.x, dz = point.z - feet.z;
    const float distance = dx * dx + dz * dz;
    if (distance >= 24.0F * 24.0F ||
        std::fabs(point.y - feet.y - kHullHalfHeightStand) > kStepHeight) return true;
    // Player separation can keep two bots 16u away from a shared waypoint.
    // Let them proceed early only when the next segment is still hull-clear.
    if (distance >= 10.0F * 10.0F && bot.path_cursor + 1 < bot.path_count) {
      const Vec3 next = g_nodes[bot.path[bot.path_cursor + 1]].origin;
      Vec3 end;
      if (!walk({feet.x, feet.y + kHullHalfHeightStand, feet.z}, next.x, next.z, end) ||
          std::fabs(end.y - next.y) >= 4.0F) return true;
    }
    ++bot.path_cursor;
  }
  return false;
}

} // namespace cs
