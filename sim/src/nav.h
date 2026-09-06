#pragma once

#include "state.h"

namespace cs {

// Static, map-derived graph. Only the route/cursor belong to rollback state.
void nav_reset();
void nav_build(const SimState& s);
bool nav_plan(SimState& s, std::uint32_t index, bool roam);
bool nav_cover(SimState& s, std::uint32_t index, Vec3 threat);
bool nav_waypoint(PlayerEntity& e, Vec3& point);

} // namespace cs
