import * as THREE from "three";
import { getPhotoTexture } from "./loader";
import {
  camo, cloud, fill, grain, reliefTextures, type Ctx, type Relief, type ReliefTextures,
} from "./textures";

// Character skins. A model of this kind lives or dies by its texture sheet:
// the mesh gives the silhouette, but the camouflage, the seams, the webbing
// and the laces are painted — and each sheet here is painted twice, once as
// colour and once as height, so the light picks out a pocket flap or a strap
// instead of sliding over a flat decal.
//
// Wrapped sheets (legs, arms, vest, head, boot, helmet) run once round the
// body: canvas x is the angle with the seam at the back and the front at the
// middle, canvas y runs from the top of the part down. All coordinates are
// authored on a 256 grid and scaled to the sheet.

export type Team = "ct" | "t";
/** Two looks a side, so a squad is not five copies of one man. */
export type Look = 0 | 1;

interface Colours {
  /** Fatigues: base and the patches printed over it. */
  cloth: string; camo: string[];
  vest: string; webbing: string; gear: string; mask: string; accent: string; boot: string;
  /** Bare hands, or the colour of the glove over them. */
  hand: string;
}

const SKIN = "#c39776";
const PALETTE: Record<Team, [Colours, Colours]> = {
  ct: [
    // Helmet, goggles and blue-grey fatigues.
    { cloth: "#4f6177", camo: ["#3b4a5f", "#647890"], vest: "#33393f", webbing: "#40474e", gear: "#24292e",
      mask: "#2a3036", accent: "#b7c0c6", boot: "#1d1f21", hand: "#26292c" },
    // Peaked cap and urban grey.
    { cloth: "#6e747a", camo: ["#50565c", "#8b9197", "#3d4247"], vest: "#2a2e33", webbing: "#363b41",
      gear: "#1e2125", mask: "#24272b", accent: "#d0d4d8", boot: "#1b1c1e", hand: "#1f2225" },
  ],
  t: [
    // Knitted cap, checked scarf, desert khaki.
    { cloth: "#96815a", camo: ["#7c6844", "#ad9a72"], vest: "#4d4332", webbing: "#5c5140", gear: "#2c2822",
      mask: "#34322e", accent: "#a4483a", boot: "#2e2519", hand: SKIN },
    // Bare head, dark glasses, woodland.
    { cloth: "#59613f", camo: ["#3d452a", "#7a6c47", "#272b1c"], vest: "#57482f", webbing: "#66563a",
      gear: "#28251b", mask: "#2b2a26", accent: "#c7b98f", boot: "#2a2218", hand: "#3a3a30" },
  ],
};

export type SkinPart = "cloth" | "legs" | "arms" | "vest" | "pouch" | "gear" | "boot" | "helmet"
  | "head" | "skin" | "hand" | "scarf";

/** Set a height-map grey: 0 is the surface, +1 stands proud, -1 is cut in. */
function level(lift: number): string {
  const v = Math.round(128 + Math.max(-1, Math.min(1, lift)) * 110);
  return `rgb(${v},${v},${v})`;
}

/** Scaled drawing on both canvases of a relief at once. */
class Sheet {
  private readonly k: number;
  constructor(readonly r: Relief) { this.k = r.color.size / 256; }

  rect(ctx: Ctx, x: number, y: number, w: number, h: number, style: string): void {
    const k = this.k;
    ctx.ctx.fillStyle = style;
    ctx.ctx.fillRect(x * k, y * k, Math.max(1, w * k), Math.max(1, h * k));
  }

  /** A panel sewn onto the surface: pocket, flap, strap, patch. */
  panel(x: number, y: number, w: number, h: number, lift: number, colour?: string): void {
    const { color, height } = this.r;
    if (colour) this.rect(color, x, y, w, h, colour);
    this.rect(color, x, y, w, 1, "rgba(255,255,255,0.1)");
    this.rect(color, x, y + h - 1, w, 1.5, "rgba(0,0,0,0.42)");
    this.rect(color, x + w - 1, y, 1, h, "rgba(0,0,0,0.28)");
    this.rect(color, x, y, 1, h, "rgba(0,0,0,0.18)");
    this.rect(height, x - 1, y - 1, w + 2, h + 2, level(lift * 0.4));
    this.rect(height, x, y, w, h, level(lift));
  }

  /** A stitched seam: a groove with thread dashed along it. */
  seam(x: number, y: number, length: number, vertical: boolean): void {
    const { color, height } = this.r;
    const w = vertical ? 1.2 : length, h = vertical ? length : 1.2;
    this.rect(color, x, y, w, h, "rgba(0,0,0,0.3)");
    this.rect(height, x - (vertical ? 0.6 : 0), y - (vertical ? 0 : 0.6), vertical ? 2.4 : length,
      vertical ? length : 2.4, level(-0.45));
    for (let at = 0; at < length; at += 5) {
      this.rect(color, vertical ? x + 1.6 : x + at, vertical ? y + at : y + 1.6, vertical ? 1 : 2.6,
        vertical ? 2.6 : 1, "rgba(235,225,200,0.2)");
    }
  }

  /** Cloth gathered into creases across a band — behind a knee, in an elbow. */
  folds(y: number, band: number, count: number, depth = 0.5): void {
    const { color, height } = this.r;
    for (let i = 0; i < count; ++i) {
      const at = y + color.random() * band, x = color.random() * 256, w = 40 + color.random() * 110;
      for (const offset of [0, -256, 256]) {
        this.rect(height, x + offset, at, w, 2.2, level(depth));
        this.rect(height, x + offset, at + 2.2, w, 2.6, level(-depth));
        this.rect(color, x + offset, at + 2.2, w, 2.6, "rgba(0,0,0,0.16)");
        this.rect(color, x + offset, at, w, 1.6, "rgba(255,255,255,0.05)");
      }
    }
  }

  /** The thread of the fabric itself, in both the colour and the relief. */
  weave(amount: number): void {
    grain(this.r.color, amount * 0.5, 1);
    grain(this.r.height, amount, 1);
  }
}

function fatigues(sheet: Sheet, colours: Colours): void {
  camo(sheet.r.color, colours.cloth, colours.camo, 34);
  cloud(sheet.r.color, 10, 80, 3);
}

function paintCloth(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fatigues(s, colours);
  s.folds(0, 256, 9, 0.3);
  s.weave(10);
}

/** Trouser leg, hip (top) to boot. The cargo pocket sits on the outer side at x 64. */
function paintLegs(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fatigues(s, colours);
  s.folds(118, 26, 7); // behind and above the knee
  s.folds(206, 34, 9, 0.6); // bloused into the boot
  s.folds(8, 30, 4, 0.3);
  s.seam(64, 0, 256, true); s.seam(192, 0, 256, true); s.seam(0, 0, 256, true);
  // Cargo pocket with a buttoned flap.
  s.panel(40, 60, 48, 52, 0.45);
  s.panel(38, 56, 52, 14, 0.7);
  s.seam(42, 108, 44, false);
  s.rect(r.color, 62, 62, 4, 4, "rgba(0,0,0,0.5)");
  // Double-layer knee, stitched all round.
  s.panel(98, 128, 60, 44, 0.22);
  s.seam(100, 131, 56, false); s.seam(100, 167, 56, false);
  s.panel(0, 246, 256, 10, 0.3);
  s.weave(9);
}

/** Sleeve, shoulder (top) to cuff. Shoulder pocket outside at x 64, elbow patch at the back. */
function paintArms(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fatigues(s, colours);
  s.folds(124, 30, 9, 0.55); // the crook of the elbow
  s.folds(196, 40, 6, 0.4);
  s.seam(0, 0, 256, true); s.seam(128, 0, 256, true);
  s.panel(42, 34, 44, 40, 0.4); // shoulder pocket
  s.panel(40, 30, 48, 12, 0.65);
  s.panel(50, 48, 28, 16, 0.2, colours.accent); // unit patch, blank
  s.rect(r.color, 50, 48, 28, 16, "rgba(0,0,0,0.25)");
  for (const x of [0, 226]) { s.panel(x, 122, 30, 44, 0.25); s.seam(x + 2, 125, 26, false); }
  s.panel(0, 238, 256, 18, 0.35); // cuff
  s.panel(110, 240, 30, 9, 0.6, colours.gear); // adjustment tab
  s.weave(9);
}

/** Plate carrier, collar (top) to hem: rows of load-bearing webbing over a plate front and back. */
function paintVest(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fill(r.color, colours.vest);
  cloud(r.color, 12, 70, 3);
  // Webbing: a strap every row, bar-tacked into loops.
  for (let y = 78; y < 244; y += 15) {
    s.panel(0, y, 256, 7, 0.38, colours.webbing);
    for (let x = 6; x < 256; x += 13) {
      s.rect(r.color, x, y, 1.2, 7, "rgba(0,0,0,0.45)");
      s.rect(r.height, x, y, 1.6, 7, level(-0.15));
    }
  }
  // Shoulder straps and their buckles, front and back.
  for (const x of [84, 158, 14, 228]) {
    s.panel(x, 0, 14, 76, 0.5, colours.webbing);
    s.seam(x + 2, 0, 76, true); s.seam(x + 11, 0, 76, true);
    s.panel(x - 1, 40, 16, 9, 0.85, colours.gear);
  }
  // Front closure flap and the admin panel above the pouches.
  s.panel(116, 30, 24, 46, 0.3, colours.webbing);
  s.seam(128, 30, 220, true);
  s.panel(140, 44, 26, 12, 0.3, colours.accent);
  s.rect(r.color, 140, 44, 26, 12, "rgba(0,0,0,0.3)");
  // Cummerbund join down each side.
  for (const x of [62, 192]) { s.panel(x, 76, 5, 170, 0.5, colours.gear); }
  // Drag handle and identification panel on the back.
  s.panel(244, 8, 12, 9, 0.9, colours.webbing); s.panel(0, 8, 12, 9, 0.9, colours.webbing);
  s.panel(226, 30, 30, 22, 0.25, colours.accent); s.panel(0, 30, 30, 22, 0.25, colours.accent);
  s.rect(r.color, 226, 30, 30, 22, "rgba(0,0,0,0.35)"); s.rect(r.color, 0, 30, 30, 22, "rgba(0,0,0,0.35)");
  // Binding round every edge.
  s.panel(0, 0, 256, 5, 0.5, colours.gear); s.panel(0, 249, 256, 7, 0.5, colours.gear);
  s.weave(12);
}

/** Nylon for pouches, belts and pads: tiled, so it is only weave and a stitched edge. */
function paintNylon(r: Relief, colour: string): void {
  const s = new Sheet(r);
  fill(r.color, colour);
  cloud(r.color, 12, 60, 3);
  for (let y = 0; y < 256; y += 32) s.seam(0, y + 6, 256, false);
  s.weave(14);
}

/** Boot, collar (top) to sole: laced up the front at x 128. */
function paintBoot(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fill(r.color, colours.boot);
  cloud(r.color, 14, 60, 3);
  s.panel(0, 0, 256, 20, 0.5); // padded collar
  s.panel(106, 16, 44, 150, 0.2); // tongue
  for (let y = 26; y < 160; y += 17) {
    for (const x of [106, 146]) { s.panel(x, y, 5, 5, 0.9, "#5c5850"); }
    s.panel(108, y + 1.5, 40, 2.4, 0.7, "#3a3833");
  }
  s.seam(40, 150, 176, false); // toe cap
  s.seam(0, 60, 60, false); s.seam(196, 60, 60, false); // heel counter
  // Welt and a lugged sole.
  s.panel(0, 222, 256, 6, 0.6, "#3b352c");
  s.panel(0, 228, 256, 28, 0.2, "#141312");
  for (let x = 4; x < 256; x += 14) s.rect(r.height, x, 232, 5, 24, level(-0.6));
  s.weave(6);
}

/** Helmet under a fabric cover: crown (top) to rim. */
function paintHelmet(r: Relief, colours: Colours, look: Look): void {
  const s = new Sheet(r);
  if (look === 0) fatigues(s, { ...colours, cloth: colours.gear, camo: [colours.vest, colours.mask] });
  else fill(r.color, colours.gear);
  cloud(r.color, 10, 60, 3);
  for (const x of [0, 64, 128, 192]) s.seam(x, 0, 190, true); // cover panels
  s.panel(0, 186, 256, 12, 0.5, colours.webbing); // band
  for (let x = 10; x < 256; x += 40) s.panel(x, 184, 8, 16, 0.75, colours.gear);
  s.panel(114, 140, 28, 44, 0.6, colours.gear); // mount plate
  s.panel(0, 244, 256, 12, 0.55, colours.gear); // rim
  s.weave(8);
}

/**
 * The head: canvas x 128 is the nose, 64 and 192 the ears, 0 the back of the
 * skull; y runs crown (top) to chin. Painted with soft edges throughout — a
 * face is all gradients, and a hard rectangle on one reads as a sticker.
 */
function paintHead(r: Relief, team: Team, colours: Colours): void {
  const x = r.color.ctx, h = r.height.ctx, k = r.color.size / 256;
  fill(r.color, SKIN);
  cloud(r.color, 10, 64, 3);
  x.save(); h.save();
  x.scale(k, k); h.scale(k, k);
  const soft = (cx: number, cy: number, rx: number, ry: number, colour: string, clear: string) => {
    const gradient = x.createRadialGradient(cx, cy, 0, cx, cy, 1);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, clear);
    x.save();
    x.translate(cx, cy); x.scale(rx, ry); x.translate(-cx, -cy);
    x.fillStyle = gradient;
    x.fillRect(cx - 1, cy - 1, 2, 2);
    x.restore();
  };
  // The planes of the face: cheeks falling away to the ears, shade under the
  // brow, the jaw and the lower lip, warmth in the cheeks and nose.
  for (const side of [-1, 1]) {
    soft(128 + side * 48, 150, 26, 80, "rgba(70,36,24,0.42)", "rgba(70,36,24,0)");
    soft(128 + side * 17, 119, 14, 9, "rgba(58,30,22,0.5)", "rgba(58,30,22,0)");
    soft(128 + side * 22, 152, 16, 14, "rgba(190,96,80,0.16)", "rgba(190,96,80,0)");
    soft(128 + side * 5, 158, 4, 5, "rgba(70,34,24,0.45)", "rgba(70,34,24,0)"); // nostril
    soft(128 + side * 5.5, 140, 3, 18, "rgba(70,36,24,0.22)", "rgba(70,36,24,0)");
  }
  soft(128, 236, 60, 24, "rgba(60,30,20,0.5)", "rgba(60,30,20,0)");
  soft(128, 206, 16, 5, "rgba(60,30,20,0.3)", "rgba(60,30,20,0)");
  soft(128, 150, 5, 12, "rgba(255,225,200,0.16)", "rgba(255,225,200,0)"); // light down the nose
  soft(128, 196, 40, 36, "rgba(45,34,28,0.2)", "rgba(45,34,28,0)"); // stubble
  // Mouth: the line between the lips, a darker upper and a fuller lower.
  x.fillStyle = "rgba(150,78,70,0.55)";
  x.beginPath(); x.ellipse(128, 192, 12, 2.6, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgba(176,100,90,0.5)";
  x.beginPath(); x.ellipse(128, 197, 10, 3.2, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgba(70,30,28,0.75)";
  x.fillRect(116, 193.6, 24, 1.3);
  h.fillStyle = level(-0.5); h.fillRect(116, 193.4, 24, 1.6);
  for (const side of [-1, 1]) {
    const ex = 128 + side * 17;
    // Brow, lid, the white, iris and pupil, then the lash line over them.
    x.strokeStyle = "#2a1f18"; x.lineWidth = 3.4; x.lineCap = "round";
    x.beginPath(); x.moveTo(ex - side * 9, 113.5); x.quadraticCurveTo(ex, 109.5, ex + side * 9, 112.5); x.stroke();
    h.strokeStyle = level(0.4); h.lineWidth = 4;
    h.beginPath(); h.moveTo(ex - 9, 113); h.lineTo(ex + 9, 113); h.stroke();
    x.fillStyle = "#e2dad0";
    x.beginPath(); x.ellipse(ex, 122, 6.4, 3, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#4a3524";
    x.beginPath(); x.arc(ex, 122, 2.9, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#0e0c0b";
    x.beginPath(); x.arc(ex, 122, 1.3, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "rgba(20,12,10,0.85)"; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(ex - 7, 121.5); x.quadraticCurveTo(ex, 117.2, ex + 7, 121.5); x.stroke();
    x.strokeStyle = "rgba(90,50,40,0.5)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(ex - 6.5, 123.5); x.quadraticCurveTo(ex, 126.4, ex + 6.5, 123.5); x.stroke();
  }
  if (team === "t") {
    // Cropped dark hair: a hairline across the forehead, back past the
    // temples, round behind the ears and down to the nape.
    const hair = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.moveTo(-8, -8); ctx.lineTo(264, -8); ctx.lineTo(264, 182);
      ctx.bezierCurveTo(236, 186, 212, 180, 204, 150);
      ctx.bezierCurveTo(200, 132, 198, 118, 190, 100);
      ctx.bezierCurveTo(186, 124, 183, 132, 181, 138);
      ctx.bezierCurveTo(178, 110, 180, 84, 168, 66);
      ctx.bezierCurveTo(152, 50, 104, 50, 88, 66);
      ctx.bezierCurveTo(76, 84, 78, 110, 75, 138);
      ctx.bezierCurveTo(73, 132, 70, 124, 66, 100);
      ctx.bezierCurveTo(58, 118, 56, 132, 52, 150);
      ctx.bezierCurveTo(44, 180, 20, 186, -8, 182);
      ctx.closePath();
    };
    x.shadowColor = "#1c1612"; x.shadowBlur = 5 * k;
    x.fillStyle = "#1f1814";
    hair(x); x.fill();
    x.shadowBlur = 0;
    h.fillStyle = level(0.3);
    hair(h); h.fill();
  } else {
    // Knitted balaclava over everything but a band across the eyes.
    const mask = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.rect(-8, -8, 272, 272);
      ctx.ellipse(128, 121, 34, 13.5, 0, 0, Math.PI * 2);
    };
    x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 3 * k;
    x.fillStyle = colours.mask;
    mask(x); x.fill("evenodd");
    x.shadowBlur = 0;
    h.fillStyle = level(0.35);
    mask(h); h.fill("evenodd");
    // Rib knit, and the creases where it stretches over the nose and jaw.
    h.fillStyle = level(0.12);
    for (let rib = 0; rib < 256; rib += 4) h.fillRect(rib, 0, 1.6, 256);
    x.fillStyle = "rgba(0,0,0,0.22)";
    for (const fold of [150, 172, 196, 222]) x.fillRect(64, fold, 128, 1.2);
    soft(128, 160, 30, 40, "rgba(255,255,255,0.06)", "rgba(255,255,255,0)");
  }
  x.restore(); h.restore();
  grain(r.color, 5, 1);
}

function paintScarf(r: Relief, colours: Colours): void {
  const s = new Sheet(r);
  fill(r.color, colours.accent);
  for (let y = 0; y < 256; y += 32) {
    for (let i = (y / 32) % 2 * 16; i < 256; i += 32) s.rect(r.color, i, y, 16, 16, "rgba(240,232,214,0.75)");
  }
  s.folds(0, 256, 22, 0.7);
  s.weave(12);
}

const sheets = new Map<string, ReliefTextures>();

function sheet(team: Team, look: Look, part: SkinPart): ReliefTextures {
  const key = `${team}${look}:${part}`;
  let textures = sheets.get(key);
  if (textures) return textures;
  const colours = PALETTE[team][look];
  const size = part === "vest" || part === "head" ? 512 : part === "cloth" || part === "pouch" || part === "gear" ? 128 : 256;
  const seed = (team === "ct" ? 21 : 22) + look * 10 + part.length * 101;
  textures = reliefTextures(size, seed, (r) => {
    switch (part) {
      case "cloth": return paintCloth(r, colours);
      case "legs": return paintLegs(r, colours);
      case "arms": return paintArms(r, colours);
      case "vest": return paintVest(r, colours);
      case "pouch": return paintNylon(r, colours.webbing);
      case "gear": return paintNylon(r, colours.gear);
      case "boot": return paintBoot(r, colours);
      case "helmet": return paintHelmet(r, colours, look);
      case "head": return paintHead(r, team, colours);
      case "scarf": return paintScarf(r, colours);
      case "skin": fill(r.color, SKIN); cloud(r.color, 10, 40, 3); return;
      case "hand": fill(r.color, colours.hand); cloud(r.color, 10, 40, 3); new Sheet(r).weave(8); return;
    }
  });
  sheets.set(key, textures);
  return textures;
}

/** How each surface answers light: matte cloth/skin, subtle sheen on leather/nylon. */
const FINISH: Record<SkinPart, [shininess: number, specular: number, bump: number]> = {
  cloth: [3, 0x080808, 1.4], legs: [3, 0x080808, 1.8], arms: [3, 0x080808, 1.8],
  vest: [6, 0x101010, 2.2], pouch: [6, 0x101010, 1.4], gear: [10, 0x161616, 1.2],
  boot: [22, 0x24201c, 2.2], helmet: [8, 0x141414, 1.8], head: [5, 0x0e0a08, 0.8],
  skin: [6, 0x100c0a, 0], hand: [7, 0x121212, 1.0], scarf: [3, 0x080808, 2.2],
};

/** Resolve a gritty preloaded operator texture for a skin part when available. */
function operatorPhotoMap(team: Team, look: Look, part: SkinPart): THREE.Texture | null {
  if (part === "head") return getPhotoTexture(team === "ct" ? "ct_head" : "t_head");
  if (part === "vest") return getPhotoTexture(team === "ct" ? "ct_vest" : "t_vest");
  if (part === "cloth" || part === "legs" || part === "arms") {
    // Look 0 uses primary team BDU; Look 1 keeps a distinct tint/camo contrast.
    if (look === 0) return getPhotoTexture(team === "ct" ? "ct_cloth" : "t_cloth");
    return getPhotoTexture(team === "ct" ? "ct_cloth" : "t_cloth");
  }
  if (part === "hand" && (team === "ct" || look === 1)) return getPhotoTexture("glove");
  if (part === "pouch" || part === "gear") return getPhotoTexture("glove");
  return null;
}

/**
 * Source's character shading on a Phong material: half-Lambert, so the side of
 * a body facing away from the light falls off into shade instead of going
 * black, and a rim that lifts the silhouette off a dark wall.
 */
function sourceShade(material: THREE.MeshPhongMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_phong_pars_fragment>", THREE.ShaderChunk.lights_phong_pars_fragment.replace(
        "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );",
        "float halfNL = dot( geometryNormal, directLight.direction ) * 0.5 + 0.5;\n\tfloat dotNL = halfNL * halfNL;"))
      .replace("#include <opaque_fragment>",
        "float rim = pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );\n" +
        "\toutgoingLight += diffuseColor.rgb * rim * 0.24;\n\t#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => "source-shade";
}

/** A fresh material per body (each is tinted on its own) over the shared, cached sheets. */
export function skinMaterial(team: Team, look: Look, part: SkinPart): THREE.MeshPhongMaterial {
  const textures = sheet(team, look, part);
  const photo = operatorPhotoMap(team, look, part);
  const [shininess, specular, bumpScale] = FINISH[part];
  const material = new THREE.MeshPhongMaterial({
    map: photo ?? textures.map,
    bumpMap: bumpScale > 0 ? textures.bumpMap : null,
    bumpScale,
    shininess,
    specular,
  });
  // Slight palette distinction between Look 0 and Look 1 when sharing photo cloth.
  if (photo && look === 1 && (part === "cloth" || part === "legs" || part === "arms")) {
    material.color.setHex(team === "ct" ? 0xbec6ce : 0x8b9676);
  }
  sourceShade(material);
  return material;
}

/** Goggle and sunglass lenses: the one glossy thing on the figure. */
export function lensMaterial(): THREE.MeshPhongMaterial {
  const material = new THREE.MeshPhongMaterial({ color: 0x14181b, shininess: 120, specular: 0xb8c6cf });
  sourceShade(material);
  return material;
}
