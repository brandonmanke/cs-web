import { Mode, Team } from "../sim";
import {
  cross, dot, normalize, sub, Surface,
  type Brush, type FaceUv, type Plane, type Vec3,
} from "./brush";
import type { MapLight } from "./build";
import type { MapDecalDef, MapDecalKind, MapDef, PropDef, PropKey, SpawnDef, SunLight } from "./mapdef";

// Quake / TrenchBroom Valve-220 `.map` parser.
//
// TrenchBroom authors brushes in GoldSrc units (1u = 1 inch) with Z-up.
// This converts every coordinate and Valve-220 texture axis into cs-web's
// Y-up space via the proper rotation (x, y, z)_TB -> (x, z, -y)_world, which
// preserves handedness and keeps outward normals exact. The resulting brushes
// feed `sim_add_brush` and the winding clipper through the exact same path as
// TypeScript-authored maps — zero duplicate collision meshes, zero drift.

/** Convert a TrenchBroom Z-up point or vector to cs-web Y-up. */
function tbToWorld(x: number, y: number, z: number): Vec3 {
  return [x, z, -y];
}

/** Infer cs::Material (footsteps + bullet penetration) from texture name. */
export function surfaceForTexture(tex: string): Surface {
  const t = tex.toLowerCase();
  if (t === "crate" || t === "wood" || t === "crate_wood" || t === "wood_door") {
    return Surface.wood;
  }
  if (t === "metal" || t === "rust" || t === "grate" || t === "tech" || t === "alloy" ||
      t === "deck" || t === "hazard" || t === "corrugated" || t === "shutter" ||
      t === "container" || t === "light" || t === "light_cool" || t === "glass") {
    return Surface.metal;
  }
  if (t === "sand") return Surface.sand;
  return Surface.concrete;
}

interface RawEntity {
  props: Record<string, string>;
  brushes: Brush[];
}

// Matches a Valve-220 brush plane line:
// ( x1 y1 z1 ) ( x2 y2 z2 ) ( x3 y3 z3 ) TEXTURE [ ux uy uz uOff ] [ vx vy vz vOff ] rot scaleX scaleY
const VALVE220_RE =
  /^\(\s*([^)]+?)\s*\)\s*\(\s*([^)]+?)\s*\)\s*\(\s*([^)]+?)\s*\)\s+(\S+)\s+\[\s*([^\]]+?)\s*\]\s+\[\s*([^\]]+?)\s*\]\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)/;

// Also accepts standard Quake format without explicit UV brackets:
// ( x1 y1 z1 ) ( x2 y2 z2 ) ( x3 y3 z3 ) TEXTURE xOff yOff rot scaleX scaleY
const STANDARD_RE =
  /^\(\s*([^)]+?)\s*\)\s*\(\s*([^)]+?)\s*\)\s*\(\s*([^)]+?)\s*\)\s+(\S+)\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)/;

function nums(s: string): number[] {
  return s.trim().split(/\s+/).map(Number);
}

function parseColor(raw: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!raw) return fallback;
  const parts = nums(raw);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  // Accept either 0..1 floats or 0..255 GoldSrc RGB integers.
  const scale = parts[0]! > 1.5 || parts[1]! > 1.5 || parts[2]! > 1.5 ? 1 / 255 : 1;
  return [parts[0]! * scale, parts[1]! * scale, parts[2]! * scale];
}

function parseVec3(raw: string | undefined, fallback: Vec3): Vec3 {
  if (!raw) return fallback;
  const parts = nums(raw);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return tbToWorld(parts[0]!, parts[1]!, parts[2]!);
}

/** Convert TrenchBroom `angle` (degrees, 0 = +X, 90 = +Y/-Z) to cs-web yaw (0 = -Z, +CCW). */
function tbAngleToYaw(deg: number): number {
  return ((deg - 90) * Math.PI) / 180;
}

function parseEntities(source: string): RawEntity[] {
  const entities: RawEntity[] = [];
  let entity: RawEntity | null = null;
  let inBrush = false;
  let planes: Plane[] = [];
  let faceTex: Record<number, string> = {};
  let faceUv: Record<number, FaceUv> = {};
  let primaryTex = "concrete";

  for (const rawLine of source.split(/\r?\n/)) {
    const comment = rawLine.indexOf("//");
    const line = (comment >= 0 ? rawLine.slice(0, comment) : rawLine).trim();
    if (!line) continue;

    if (line === "{") {
      if (!entity) {
        entity = { props: {}, brushes: [] };
      } else {
        inBrush = true;
        planes = [];
        faceTex = {};
        faceUv = {};
        primaryTex = "concrete";
      }
      continue;
    }

    if (line === "}") {
      if (inBrush && entity) {
        inBrush = false;
        if (planes.length >= 4) {
          const solid = entity.props.solid !== "0";
          entity.brushes.push({
            planes,
            surface: surfaceForTexture(primaryTex),
            tex: primaryTex,
            faceTex,
            faceUv: Object.keys(faceUv).length > 0 ? faceUv : undefined,
            solid,
          });
        }
      } else if (entity) {
        entities.push(entity);
        entity = null;
      }
      continue;
    }

    if (!entity) continue;

    if (!inBrush) {
      const m = /^"([^"]+)"\s+"([^"]*)"/.exec(line);
      if (m) entity.props[m[1]!] = m[2]!;
      continue;
    }

    // Parse a brush face plane.
    const v220 = VALVE220_RE.exec(line);
    const std = v220 ? null : STANDARD_RE.exec(line);
    const match = v220 ?? std;
    if (!match) continue;

    const a = nums(match[1]!);
    const b = nums(match[2]!);
    const c = nums(match[3]!);
    if (a.length < 3 || b.length < 3 || c.length < 3) continue;

    const p1 = tbToWorld(a[0]!, a[1]!, a[2]!);
    const p2 = tbToWorld(b[0]!, b[1]!, b[2]!);
    const p3 = tbToWorld(c[0]!, c[1]!, c[2]!);
    // In Quake/Valve .map files, p1->p2->p3 is clockwise seen from outside,
    // so (p3 - p1) x (p2 - p1) points outward.
    const n = normalize(cross(sub(p3, p1), sub(p2, p1)));
    const idx = planes.length;
    planes.push({ n, d: dot(n, p1) });

    const tex = match[4]!.toLowerCase();
    if (idx === 0) primaryTex = tex;
    faceTex[idx] = tex;

    if (v220) {
      const u = nums(v220[5]!);
      const v = nums(v220[6]!);
      const scaleU = Number(v220[8]!) || 1;
      const scaleV = Number(v220[9]!) || 1;
      if (u.length >= 4 && v.length >= 4) {
        faceUv[idx] = {
          uAxis: tbToWorld(u[0]!, u[1]!, u[2]!),
          uOffset: u[3]!,
          uScale: scaleU,
          vAxis: tbToWorld(v[0]!, v[1]!, v[2]!),
          vOffset: v[3]!,
          vScale: scaleV,
        };
      }
    }
  }
  return entities;
}

/**
 * Parse a TrenchBroom / Valve-220 `.map` text file into a full cs-web `MapDef`.
 * Can be called identically in the browser (via Vite `?raw`) and in Node (`mapcheck`).
 */
export function parseValveMap(name: string, source: string): MapDef {
  const entities = parseEntities(source);
  const brushes: Brush[] = [];
  const lights: MapLight[] = [];
  const spawns: SpawnDef[] = [];
  const props: PropDef[] = [];
  const decals: MapDecalDef[] = [];

  let sun: SunLight | undefined;
  let ambient: [number, number, number] = [0.14, 0.145, 0.16];
  let mode: number = Mode.team;
  let bots = 7;
  let background = 0x9aa8b2;
  let sky: MapDef["sky"];
  let fog: [number, number] = [1400, 4200];

  for (const ent of entities) {
    const cls = ent.props.classname ?? "";
    if (cls === "worldspawn") {
      brushes.push(...ent.brushes);
      ambient = parseColor(ent.props.ambient, ambient);
      if (ent.props.mode === "deathmatch") mode = Mode.deathmatch;
      else if (ent.props.mode === "range") mode = Mode.range;
      else if (ent.props.mode === "team") mode = Mode.team;
      if (ent.props.bots !== undefined) bots = Number(ent.props.bots) || bots;
      if (ent.props.background) background = parseInt(ent.props.background.replace(/^#|^0x/i, ""), 16);
      if (ent.props.sky === "desert" || ent.props.sky === "dusk" || ent.props.sky === "orbital") {
        sky = ent.props.sky;
      }
      if (ent.props.fog) {
        const f = nums(ent.props.fog);
        if (f.length >= 2) fog = [f[0]!, f[1]!];
      }
      continue;
    }

    if (cls === "func_detail" || cls === "func_wall") {
      brushes.push(...ent.brushes);
      continue;
    }

    if (cls === "light") {
      const pos = parseVec3(ent.props.origin, [0, 64, 0]);
      const parts = ent.props._light ? nums(ent.props._light) : [];
      let color: [number, number, number] = [1, 0.9, 0.72];
      let intensity = 1.2;
      if (parts.length >= 4) {
        const scale = parts[0]! > 1.5 || parts[1]! > 1.5 || parts[2]! > 1.5 ? 1 / 255 : 1;
        color = [parts[0]! * scale, parts[1]! * scale, parts[2]! * scale];
        intensity = parts[3]! > 10 ? parts[3]! / 200 : parts[3]!;
      } else {
        color = parseColor(ent.props.color, color);
        if (ent.props.intensity) intensity = Number(ent.props.intensity);
      }
      const radius = Number(ent.props.radius) || 640;
      lights.push({ pos, color, intensity, radius });
      continue;
    }

    if (cls === "light_environment") {
      const dir = normalize(parseVec3(ent.props.dir, [0.45, -0.55, 0.72]));
      const color = parseColor(ent.props.color, [1.0, 0.92, 0.76]);
      const intensity = Number(ent.props.intensity) || 1.25;
      const skyColor = parseColor(ent.props.sky_color, [0.55, 0.68, 0.85]);
      const skyIntensity = Number(ent.props.sky_intensity) || 0.42;
      sun = { dir, color, intensity, skyColor, skyIntensity };
      continue;
    }

    if (cls === "info_player_start" || cls === "info_player_deathmatch") {
      const pos = parseVec3(ent.props.origin, [0, 40, 0]);
      const yaw = tbAngleToYaw(Number(ent.props.angle) || 0);
      const team = ent.props.team === "ct" ? Team.ct
        : ent.props.team === "t" ? Team.t
        : ent.props.team === "none" ? Team.none
        : cls === "info_player_start" ? Team.ct : Team.t;
      spawns.push({ pos, yaw, team });
      continue;
    }

    if (cls === "prop_static") {
      const model = ent.props.model as PropKey | undefined;
      if (model) {
        props.push({
          model,
          pos: parseVec3(ent.props.origin, [0, 0, 0]),
          yaw: tbAngleToYaw(Number(ent.props.angle) || 0),
          scale: ent.props.scale ? Number(ent.props.scale) : undefined,
        });
      }
      continue;
    }

    if (cls === "infodecal") {
      const kind = ent.props.texture as MapDecalKind | undefined;
      if (kind) {
        decals.push({
          kind,
          pos: parseVec3(ent.props.origin, [0, 0, 0]),
          normal: normalize(parseVec3(ent.props.normal, [0, 1, 0])),
          size: Number(ent.props.size) || 64,
          rotation: ent.props.rotation ? (Number(ent.props.rotation) * Math.PI) / 180 : 0,
        });
      }
    }
  }

  return {
    name,
    brushes,
    lights,
    sun,
    ambient,
    mode,
    bots,
    spawns,
    props,
    decals,
    background,
    sky,
    fog,
  };
}
