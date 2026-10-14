// textures.ts — canvas-generated textures: planet equirect maps + card art.
// Card art is drawn iconography: every card reads as its archetype at a glance
// (laser beams, metal impacts, radiation trefoils, speed chevrons, wrenches…).
import * as THREE from 'three';
import { makeNoise2, makeRng } from '@/core/rng';
import { PLANET_TYPES, type PlanetType } from '@/map/planet-gen';

const planetCache = new Map<string, THREE.CanvasTexture>();

export function planetTexture(seedKey: string, type: PlanetType): THREE.CanvasTexture {
  const key = `${seedKey}:${type}`;
  const cached = planetCache.get(key);
  if (cached) return cached;

  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const noise = makeNoise2(seedKey + ':map');
  const pal = PLANET_TYPES[type].palette.terrain.map((h) => new THREE.Color(h));
  const img = g.createImageData(W, H);
  const d = img.data;
  const lift = new THREE.Color('#ffffff');
  for (let y = 0; y < H; y++) {
    const lat = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const sx = Math.cos(lon) * 2 + 4, sy = Math.sin(lon) * 2 + 4;
      const n = noise.fbm(sx + Math.cos(lat) * 1.4, sy + lat * 2.1, 5);
      const f = Math.max(0, Math.min(0.999, n * 1.25 - 0.1));
      const idx = Math.min(2, Math.floor(f * 3));
      const t = f * 3 - idx;
      const col = pal[idx]!.clone().lerp(pal[idx + 1]!, t).lerp(lift, 0.08);
      const polar = Math.abs(Math.cos(lat));
      if ((type === 'ice' || type === 'garden') && polar > 0.82) col.lerp(new THREE.Color('#e8f6fa'), (polar - 0.82) * 4);
      const i = (y * W + x) * 4;
      d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (type === 'colony' || type === 'feral' || type === 'foundry') {
    const rng = makeRng(seedKey + ':lights');
    g.fillStyle = type === 'feral' ? '#ff5d4a' : '#ffd28a';
    for (let i = 0; i < 110; i++) {
      g.globalAlpha = 0.3 + rng.next() * 0.7;
      g.fillRect(rng.next() * W, H * 0.2 + rng.next() * H * 0.6, 1.5, 1.5);
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  planetCache.set(key, tex);
  if (planetCache.size > 24) {
    const first = planetCache.keys().next().value as string;
    planetCache.get(first)?.dispose();
    planetCache.delete(first);
  }
  return tex;
}

// ================================================================ planet thumbnails

const thumbCache = new Map<string, string>();

/** A shaded "3D" sphere preview of a planet, for the destination picker. */
export function planetThumb(seedKey: string, type: PlanetType, size = 112): string {
  const key = `${seedKey}:${type}:${size}`;
  const cached = thumbCache.get(key);
  if (cached) return cached;

  const src = planetTexture(seedKey, type).image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size * 0.42;
  const cx = size / 2, cy = size / 2;
  const def = PLANET_TYPES[type];

  // atmosphere halo
  g.save();
  g.shadowColor = def.palette.atmo;
  g.shadowBlur = size * 0.13;
  g.fillStyle = def.palette.atmo;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.restore();

  // planet surface (slice of the equirect map, slightly zoomed)
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.drawImage(src, src.width * 0.18, 0, src.width * 0.5, src.height, cx - r * 1.15, cy - r * 1.15, r * 2.3, r * 2.3);
  // day/night shading
  const sh = g.createRadialGradient(cx - r * 0.55, cy - r * 0.55, r * 0.2, cx, cy, r * 1.5);
  sh.addColorStop(0, 'rgba(255,255,255,0.22)');
  sh.addColorStop(0.45, 'rgba(255,255,255,0)');
  sh.addColorStop(0.78, 'rgba(4,8,16,0.35)');
  sh.addColorStop(1, 'rgba(4,8,16,0.85)');
  g.fillStyle = sh;
  g.fillRect(0, 0, size, size);
  g.restore();

  // rim light
  g.strokeStyle = def.palette.atmo;
  g.globalAlpha = 0.85;
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;

  // rings for derelict/tomb worlds
  if (type === 'derelict' || type === 'tomb') {
    g.strokeStyle = '#7d92ad';
    g.lineWidth = 2;
    g.globalAlpha = 0.7;
    g.beginPath(); g.ellipse(cx, cy, r * 1.45, r * 0.4, -0.42, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }

  const url = c.toDataURL();
  thumbCache.set(key, url);
  if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value as string);
  return url;
}

// ================================================================ card art

interface ArtTheme { fg: string; fg2: string; bgTop: string; bgBot: string }

const THEMES: Record<string, ArtTheme> = {
  laser: { fg: '#7fe9ff', fg2: '#ffffff', bgTop: '#123a52', bgBot: '#071b2c' },
  kinetic: { fg: '#ffb36a', fg2: '#ffe2c4', bgTop: '#4a2c16', bgBot: '#241208' },
  nuclear: { fg: '#e2ff5e', fg2: '#9aef3a', bgTop: '#37430f', bgBot: '#161f05' },
  speed: { fg: '#cfe9f8', fg2: '#8fd0ff', bgTop: '#2a4258', bgBot: '#101f2e' },
  repair: { fg: '#7df0b2', fg2: '#d7ffe9', bgTop: '#144830', bgBot: '#072216' },
  neutral: { fg: '#d8e4ee', fg2: '#9fb6c8', bgTop: '#36465a', bgBot: '#16212e' },
  paradox: { fg: '#cba6ff', fg2: '#ffffff', bgTop: '#34204f', bgBot: '#150b26' },
  status: { fg: '#8c9aa6', fg2: '#5a6772', bgTop: '#2a3138', bgBot: '#13181d' },
};

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, t: ArtTheme, rng: ReturnType<typeof makeRng>) => void;

const line = (g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void => {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
};
const poly = (g: CanvasRenderingContext2D, pts: number[][], close = true): void => {
  g.beginPath();
  g.moveTo(pts[0]![0]!, pts[0]![1]!);
  for (const p of pts.slice(1)) g.lineTo(p[0]!, p[1]!);
  if (close) g.closePath();
};
const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
};
const glowOn = (g: CanvasRenderingContext2D, color: string, blur = 8): void => { g.shadowColor = color; g.shadowBlur = blur; };
const glowOff = (g: CanvasRenderingContext2D): void => { g.shadowBlur = 0; };

function beamH(g: CanvasRenderingContext2D, x1: number, x2: number, y: number, t: ArtTheme, width = 5): void {
  glowOn(g, t.fg, 10);
  g.strokeStyle = t.fg; g.lineWidth = width; g.lineCap = 'round';
  line(g, x1, y, x2, y);
  g.strokeStyle = t.fg2; g.lineWidth = Math.max(1.5, width * 0.35);
  line(g, x1, y, x2, y);
  glowOff(g);
}

function impactStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: ArtTheme): void {
  glowOn(g, t.fg, 8);
  g.strokeStyle = t.fg2; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    line(g, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  glowOff(g);
}

function trefoil(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: ArtTheme): void {
  glowOn(g, t.fg, 9);
  g.fillStyle = t.fg;
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 - Math.PI / 2 - 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r, a0, a0 + 1.05);
    g.closePath();
    g.fill();
  }
  g.fillStyle = t.bgBot;
  dot(g, x, y, r * 0.32);
  g.fillStyle = t.fg;
  dot(g, x, y, r * 0.18);
  glowOff(g);
}

function chevrons(g: CanvasRenderingContext2D, x: number, y: number, n: number, t: ArtTheme, size = 12): void {
  g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    g.strokeStyle = i === n - 1 ? t.fg2 : t.fg;
    g.globalAlpha = 0.45 + (i / n) * 0.55;
    glowOn(g, t.fg, 6);
    poly(g, [[x + i * size, y - size], [x + i * size + size * 0.8, y], [x + i * size, y + size]], false);
    g.stroke();
  }
  g.globalAlpha = 1;
  glowOff(g);
}

function shieldShape(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r, y - r * 0.8, x + r * 0.9, y - r * 0.1);
  g.quadraticCurveTo(x + r * 0.8, y + r * 0.7, x, y + r);
  g.quadraticCurveTo(x - r * 0.8, y + r * 0.7, x - r * 0.9, y - r * 0.1);
  g.quadraticCurveTo(x - r, y - r * 0.8, x, y - r);
  g.closePath();
}

const PAINTERS: Record<string, Painter> = {
  // ---------------------------------------------------------------- LASER
  beam: (g, w, h, t) => {
    g.fillStyle = t.fg; g.fillRect(8, h / 2 - 7, 10, 14);
    beamH(g, 18, w - 14, h / 2, t, 6);
    impactStar(g, w - 14, h / 2, 10, t);
  },
  twinbeam: (g, w, h, t) => {
    g.fillStyle = t.fg; g.fillRect(8, h / 2 - 13, 9, 10); g.fillRect(8, h / 2 + 3, 9, 10);
    beamH(g, 17, w - 16, h / 2 - 8, t, 4);
    beamH(g, 17, w - 12, h / 2 + 8, t, 4);
    impactStar(g, w - 14, h / 2, 8, t);
  },
  prismArt: (g, w, h, t) => {
    beamH(g, 6, w * 0.42, h / 2, t, 4);
    g.strokeStyle = t.fg2; g.lineWidth = 2;
    poly(g, [[w * 0.42, h * 0.22], [w * 0.58, h * 0.78], [w * 0.3, h * 0.78]]);
    g.stroke();
    glowOn(g, t.fg, 8);
    g.strokeStyle = t.fg; g.lineWidth = 3; g.lineCap = 'round';
    line(g, w * 0.52, h / 2, w - 8, h * 0.22);
    line(g, w * 0.52, h / 2, w - 8, h * 0.5);
    line(g, w * 0.52, h / 2, w - 8, h * 0.78);
    glowOff(g);
  },
  flashArt: (g, w, h, t) => {
    glowOn(g, t.fg, 12);
    g.strokeStyle = t.fg; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      line(g, w / 2 + Math.cos(a) * 6, h / 2 + Math.sin(a) * 6, w / 2 + Math.cos(a) * 22, h / 2 + Math.sin(a) * 22);
    }
    g.fillStyle = t.fg2;
    dot(g, w / 2, h / 2, 6);
    glowOff(g);
  },
  capacitorArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 3;
    g.strokeRect(w / 2 - 14, h / 2 - 16, 28, 32);
    glowOn(g, t.fg, 8);
    g.strokeStyle = t.fg2; g.lineWidth = 2.5; g.lineJoin = 'round';
    poly(g, [[w / 2 + 4, h / 2 - 12], [w / 2 - 6, h / 2 + 2], [w / 2 + 1, h / 2 + 2], [w / 2 - 4, h / 2 + 13]], false);
    g.stroke();
    glowOff(g);
    g.fillStyle = t.fg;
    g.fillRect(w / 2 - 8, h / 2 - 21, 6, 5);
    g.fillRect(w / 2 + 2, h / 2 - 21, 6, 5);
  },
  lensArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2;
    for (const yy of [-14, 0, 14]) {
      line(g, 8, h / 2 + yy, w * 0.45, h / 2 + yy * 0.8);
      line(g, w * 0.52, h / 2 + yy * 0.5, w - 12, h / 2);
    }
    glowOn(g, t.fg, 8);
    g.strokeStyle = t.fg2; g.lineWidth = 2.5;
    g.beginPath(); g.ellipse(w * 0.48, h / 2, 5, 18, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = t.fg2;
    dot(g, w - 12, h / 2, 4);
    glowOff(g);
  },
  veilArt: (g, w, h, t) => {
    shieldShape(g, w / 2, h / 2, 19);
    g.strokeStyle = t.fg; g.lineWidth = 2.5; glowOn(g, t.fg, 8); g.stroke(); glowOff(g);
    beamH(g, w / 2 - 11, w / 2 + 11, h / 2, t, 3);
  },

  // ---------------------------------------------------------------- KINETIC
  punch: (g, w, h, t) => {
    // piston fist driving right into an impact star
    g.fillStyle = t.fg2;
    g.fillRect(8, h / 2 - 5, 26, 10);
    g.fillStyle = t.fg;
    g.fillRect(32, h / 2 - 11, 18, 22);
    g.fillStyle = t.bgBot;
    for (const yy of [-6, 0, 6]) dot(g, 41, h / 2 + yy, 1.6);
    impactStar(g, w - 20, h / 2, 13, t);
  },
  slugArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2; g.globalAlpha = 0.6;
    for (const yy of [-8, 0, 8]) line(g, 8, h / 2 + yy, 34, h / 2 + yy);
    g.globalAlpha = 1;
    glowOn(g, t.fg, 6);
    g.fillStyle = t.fg2;
    g.beginPath();
    g.moveTo(w - 16, h / 2);
    g.lineTo(w - 34, h / 2 - 8);
    g.lineTo(w - 50, h / 2 - 8);
    g.lineTo(w - 50, h / 2 + 8);
    g.lineTo(w - 34, h / 2 + 8);
    g.closePath();
    g.fill();
    glowOff(g);
  },
  volleyArt: (g, w, h, t) => {
    glowOn(g, t.fg, 5);
    g.fillStyle = t.fg2;
    for (const [dx, dy] of [[0, -12], [10, 0], [0, 12]]) {
      g.beginPath();
      g.moveTo(w * 0.62 + dx!, h / 2 + dy!);
      g.lineTo(w * 0.42 + dx!, h / 2 + dy! - 5);
      g.lineTo(w * 0.42 + dx!, h / 2 + dy! + 5);
      g.closePath();
      g.fill();
      g.strokeStyle = t.fg; g.lineWidth = 1.5; g.globalAlpha = 0.6;
      line(g, 10 + dx!, h / 2 + dy!, w * 0.4 + dx!, h / 2 + dy!);
      g.globalAlpha = 1;
    }
    glowOff(g);
  },
  flakArt: (g, w, h, t) => {
    glowOn(g, t.fg, 6);
    g.fillStyle = t.fg;
    const rng2 = makeRng('flak');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 12 + rng2.next() * 12;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.6;
      poly(g, [[x, y - 4], [x + 4, y + 3], [x - 4, y + 2]]);
      g.fill();
    }
    g.fillStyle = t.fg2;
    dot(g, w / 2, h / 2, 5);
    glowOff(g);
  },
  cannonArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    g.fillRect(10, h / 2 - 7, 38, 14);
    g.fillStyle = t.fg2;
    g.fillRect(44, h / 2 - 9, 8, 18);
    glowOn(g, '#ffd27f', 12);
    g.fillStyle = '#ffd27f';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      dot(g, 60 + Math.cos(a) * 7, h / 2 + Math.sin(a) * 7, 3.2);
    }
    dot(g, 60, h / 2, 6);
    glowOff(g);
  },
  braceArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    g.fillRect(w / 2 - 22, h / 2 - 17, 44, 34);
    g.strokeStyle = t.bgBot; g.lineWidth = 2;
    line(g, w / 2 - 22, h / 2, w / 2 + 22, h / 2);
    line(g, w / 2, h / 2 - 17, w / 2, h / 2 + 17);
    g.fillStyle = t.fg2;
    for (const dx of [-16, -6, 6, 16]) for (const dy of [-11, 11]) dot(g, w / 2 + dx, h / 2 + dy, 2);
  },
  springArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 3.5; g.lineJoin = 'round';
    const pts: number[][] = [[14, h / 2]];
    for (let i = 0; i < 7; i++) pts.push([20 + i * 8, h / 2 + (i % 2 ? 13 : -13)]);
    pts.push([w - 14, h / 2]);
    poly(g, pts, false);
    g.stroke();
    g.fillStyle = t.fg2;
    g.fillRect(8, h / 2 - 10, 6, 20);
    g.fillRect(w - 14, h / 2 - 10, 6, 20);
  },

  // ---------------------------------------------------------------- NUCLEAR
  trefoilArt: (g, w, h, t) => trefoil(g, w / 2, h / 2, 19, t),
  atomArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2;
    for (const rot of [0, Math.PI / 3, -Math.PI / 3]) {
      g.beginPath(); g.ellipse(w / 2, h / 2, 23, 9, rot, 0, Math.PI * 2); g.stroke();
    }
    glowOn(g, t.fg2, 10);
    g.fillStyle = t.fg2;
    dot(g, w / 2, h / 2, 5);
    g.fillStyle = t.fg;
    dot(g, w / 2 + 20, h / 2 - 5, 2.5);
    dot(g, w / 2 - 17, h / 2 + 9, 2.5);
    glowOff(g);
  },
  warheadArt: (g, w, h, t) => {
    g.fillStyle = t.fg2;
    g.beginPath();
    g.moveTo(w / 2, 6);
    g.lineTo(w / 2 + 9, 20);
    g.lineTo(w / 2 + 9, h - 18);
    g.lineTo(w / 2 + 15, h - 8);
    g.lineTo(w / 2 - 15, h - 8);
    g.lineTo(w / 2 - 9, h - 18);
    g.lineTo(w / 2 - 9, 20);
    g.closePath();
    g.fill();
    trefoil(g, w / 2, h / 2 + 2, 7, { ...t, fg: t.bgBot });
  },
  meltdownArt: (g, w, h, t) => {
    glowOn(g, t.fg, 10);
    g.fillStyle = t.fg;
    g.beginPath(); g.ellipse(w / 2, h * 0.32, 19, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(w / 2 - 5, h * 0.38, 10, h * 0.3);
    g.beginPath(); g.ellipse(w / 2, h * 0.75, 13, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = t.fg2;
    g.beginPath(); g.ellipse(w / 2, h * 0.3, 10, 6, 0, 0, Math.PI * 2); g.fill();
    glowOff(g);
  },
  reactorArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 3;
    g.beginPath(); g.arc(w / 2, h * 0.62, 18, Math.PI, 0); g.stroke();
    line(g, w / 2 - 18, h * 0.62, w / 2 + 18, h * 0.62);
    glowOn(g, t.fg2, 12);
    g.fillStyle = t.fg2;
    dot(g, w / 2, h * 0.5, 6);
    glowOff(g);
    g.strokeStyle = t.fg; g.lineWidth = 1.5;
    for (const dx of [-26, 26]) line(g, w / 2 + dx, h * 0.62, w / 2 + dx, h * 0.3);
  },
  barrelArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    g.fillRect(w / 2 - 13, h / 2 - 17, 26, 34);
    g.strokeStyle = t.bgBot; g.lineWidth = 2;
    for (const dy of [-10, 0, 10]) line(g, w / 2 - 13, h / 2 + dy, w / 2 + 13, h / 2 + dy);
    trefoil(g, w / 2, h / 2 - 4, 6, { ...t, fg: t.bgBot });
    glowOn(g, t.fg2, 8);
    g.fillStyle = t.fg2;
    dot(g, w / 2 + 9, h / 2 + 19, 3);
    dot(g, w / 2 - 7, h / 2 + 20, 2.2);
    glowOff(g);
  },

  // ---------------------------------------------------------------- SPEED
  dashArt: (g, w, h, t) => chevrons(g, w / 2 - 26, h / 2, 4, t, 13),
  wingArt: (g, w, h, t) => {
    glowOn(g, t.fg, 6);
    g.fillStyle = t.fg;
    g.beginPath();
    g.moveTo(12, h * 0.7);
    g.quadraticCurveTo(w * 0.45, h * 0.1, w - 10, h * 0.25);
    g.quadraticCurveTo(w * 0.55, h * 0.45, 12, h * 0.7);
    g.fill();
    g.strokeStyle = t.fg2; g.lineWidth = 1.5; g.globalAlpha = 0.7;
    for (const yy of [8, 14]) line(g, 18, h * 0.7 + yy, w * 0.6, h * 0.62 + yy);
    g.globalAlpha = 1;
    glowOff(g);
  },
  scoutArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2.5;
    for (const r of [10, 17, 24]) {
      g.beginPath(); g.arc(w / 2, h * 0.78, r, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    }
    glowOn(g, t.fg2, 9);
    g.fillStyle = t.fg2;
    dot(g, w / 2 + 11, h * 0.34, 4);
    glowOff(g);
    g.fillStyle = t.fg;
    dot(g, w / 2, h * 0.78, 3);
  },
  gaugeArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 3;
    g.beginPath(); g.arc(w / 2, h * 0.72, 20, Math.PI, 0); g.stroke();
    g.strokeStyle = t.fg; g.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) {
      const a = Math.PI + (i / 4) * Math.PI;
      line(g, w / 2 + Math.cos(a) * 16, h * 0.72 + Math.sin(a) * 16, w / 2 + Math.cos(a) * 20, h * 0.72 + Math.sin(a) * 20);
    }
    glowOn(g, t.fg2, 8);
    g.strokeStyle = t.fg2; g.lineWidth = 3; g.lineCap = 'round';
    line(g, w / 2, h * 0.72, w / 2 + 13, h * 0.72 - 13);
    glowOff(g);
  },
  skipArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2.5;
    g.beginPath(); g.arc(w / 2 - 6, h / 2, 16, 0, Math.PI * 2); g.stroke();
    line(g, w / 2 - 6, h / 2 - 9, w / 2 - 6, h / 2);
    line(g, w / 2 - 6, h / 2, w / 2 + 2, h / 2 + 5);
    glowOn(g, t.fg2, 7);
    g.fillStyle = t.fg2;
    poly(g, [[w / 2 + 16, h / 2 - 9], [w / 2 + 28, h / 2], [w / 2 + 16, h / 2 + 9]]);
    g.fill();
    glowOff(g);
  },

  // ---------------------------------------------------------------- REPAIR
  wrenchArt: (g, w, h, t) => {
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 4);
    glowOn(g, t.fg, 5);
    g.fillStyle = t.fg;
    g.fillRect(-4, -6, 8, 26);
    g.beginPath(); g.arc(0, -10, 10, Math.PI * 0.25, Math.PI * 1.75); g.lineTo(0, -10); g.closePath(); g.fill();
    g.fillRect(-7, 18, 14, 6);
    glowOff(g);
    g.restore();
    g.fillStyle = t.fg2;
    dot(g, w / 2 + 17, h / 2 - 16, 2);
    dot(g, w / 2 + 22, h / 2 - 9, 1.6);
  },
  shieldArt: (g, w, h, t) => {
    shieldShape(g, w / 2, h / 2, 20);
    glowOn(g, t.fg, 8);
    g.fillStyle = t.fg;
    g.fill();
    glowOff(g);
    g.strokeStyle = t.fg2; g.lineWidth = 2;
    shieldShape(g, w / 2, h / 2, 14);
    g.stroke();
  },
  naniteArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 1.8;
    const hex = (x: number, y: number, r: number): void => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.stroke();
    };
    const rng2 = makeRng('nan');
    for (let i = 0; i < 7; i++) hex(16 + rng2.next() * (w - 32), 12 + rng2.next() * (h - 24), 5 + rng2.next() * 4);
    glowOn(g, t.fg2, 7);
    g.strokeStyle = t.fg2; g.lineWidth = 4; g.lineCap = 'round';
    line(g, w / 2 - 7, h / 2, w / 2 + 7, h / 2);
    line(g, w / 2, h / 2 - 7, w / 2, h / 2 + 7);
    glowOff(g);
  },
  healArt: (g, w, h, t) => {
    glowOn(g, t.fg, 9);
    g.fillStyle = t.fg;
    g.fillRect(w / 2 - 6, h / 2 - 17, 12, 34);
    g.fillRect(w / 2 - 17, h / 2 - 6, 34, 12);
    glowOff(g);
    g.fillStyle = t.fg2;
    dot(g, w / 2 + 20, h / 2 - 16, 2);
    dot(g, w / 2 - 22, h / 2 + 13, 1.6);
  },
  thornsArt: (g, w, h, t) => {
    shieldShape(g, w / 2, h / 2, 17);
    g.fillStyle = t.fg;
    g.fill();
    glowOn(g, t.fg2, 6);
    g.strokeStyle = t.fg2; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      line(g, w / 2 + Math.cos(a) * 17, h / 2 + Math.sin(a) * 17, w / 2 + Math.cos(a) * 26, h / 2 + Math.sin(a) * 26);
    }
    glowOff(g);
  },

  // ---------------------------------------------------------------- NEUTRAL
  clawArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.arc(w / 2, h * 0.4, 14, Math.PI * 0.15, Math.PI * 0.85, true); g.stroke();
    for (const a of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75]) {
      line(g, w / 2 + Math.cos(a) * 14, h * 0.4 + Math.sin(a) * 14, w / 2 + Math.cos(a) * 22, h * 0.4 + Math.sin(a) * 24);
    }
    glowOn(g, t.fg2, 6);
    g.fillStyle = t.fg2;
    poly(g, [[w / 2 - 8, h * 0.74], [w / 2 + 9, h * 0.7], [w / 2 + 4, h * 0.9], [w / 2 - 10, h * 0.86]]);
    g.fill();
    glowOff(g);
  },
  gearArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.save();
      g.translate(w / 2 + Math.cos(a) * 16, h / 2 + Math.sin(a) * 16);
      g.rotate(a);
      g.fillRect(-3.5, -4, 7, 8);
      g.restore();
    }
    g.beginPath(); g.arc(w / 2, h / 2, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = t.bgBot;
    dot(g, w / 2, h / 2, 6);
  },
  cpuArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    g.fillRect(w / 2 - 15, h / 2 - 15, 30, 30);
    g.strokeStyle = t.fg; g.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      line(g, w / 2 + i * 6, h / 2 - 15, w / 2 + i * 6, h / 2 - 21);
      line(g, w / 2 + i * 6, h / 2 + 15, w / 2 + i * 6, h / 2 + 21);
      line(g, w / 2 - 15, h / 2 + i * 6, w / 2 - 21, h / 2 + i * 6);
      line(g, w / 2 + 15, h / 2 + i * 6, w / 2 + 21, h / 2 + i * 6);
    }
    glowOn(g, t.fg2, 8);
    g.strokeStyle = t.fg2; g.lineWidth = 2.5; g.lineJoin = 'round';
    poly(g, [[w / 2 + 4, h / 2 - 9], [w / 2 - 4, h / 2 + 1], [w / 2 + 1, h / 2 + 1], [w / 2 - 3, h / 2 + 10]], false);
    g.stroke();
    glowOff(g);
  },
  ventArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    for (let i = 0; i < 4; i++) g.fillRect(w / 2 - 22 + i * 12, h / 2 - 2, 8, 18);
    g.strokeStyle = t.fg2; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const x = w / 2 - 18 + i * 12;
      g.beginPath();
      g.moveTo(x, h / 2 - 8);
      g.quadraticCurveTo(x - 4, h / 2 - 14, x, h / 2 - 19);
      g.stroke();
    }
  },
  memoryArt: (g, w, h, t) => {
    glowOn(g, t.fg, 10);
    g.fillStyle = t.fg;
    poly(g, [[w / 2, h / 2 - 19], [w / 2 + 13, h / 2], [w / 2, h / 2 + 19], [w / 2 - 13, h / 2]]);
    g.fill();
    glowOff(g);
    g.strokeStyle = t.bgBot; g.lineWidth = 1.5;
    line(g, w / 2, h / 2 - 12, w / 2, h / 2 + 12);
    line(g, w / 2 - 7, h / 2, w / 2 + 7, h / 2);
  },
  genesisArt: (g, w, h) => {
    glowOn(g, '#ffd700', 12);
    g.fillStyle = '#ffd700';
    poly(g, [[w / 2, h / 2 - 16], [w / 2 + 12, h / 2 - 6], [w / 2 + 8, h / 2 + 12], [w / 2 - 8, h / 2 + 12], [w / 2 - 12, h / 2 - 6]]);
    g.fill();
    g.fillStyle = '#fff7d0';
    dot(g, w / 2, h / 2 - 1, 4);
    glowOff(g);
  },

  // ---------------------------------------------------------------- PARADOX
  spiralArt: (g, w, h, t) => {
    glowOn(g, t.fg, 9);
    g.strokeStyle = t.fg; g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.15) {
      const r = 2 + a * 1.45;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.75;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = t.fg2;
    dot(g, w / 2, h / 2, 2.5);
    glowOff(g);
  },
  hourglassArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2.5; g.lineJoin = 'round';
    poly(g, [[w / 2 - 13, h / 2 - 17], [w / 2 + 13, h / 2 - 17], [w / 2 - 13, h / 2 + 17], [w / 2 + 13, h / 2 + 17]]);
    g.stroke();
    glowOn(g, t.fg2, 7);
    g.fillStyle = t.fg2;
    poly(g, [[w / 2 - 8, h / 2 - 14], [w / 2 + 8, h / 2 - 14], [w / 2, h / 2 - 3]]);
    g.fill();
    poly(g, [[w / 2, h / 2 + 6], [w / 2 + 6, h / 2 + 15], [w / 2 - 6, h / 2 + 15]]);
    g.fill();
    glowOff(g);
  },
  horizonArt: (g, w, h, t) => {
    glowOn(g, '#ffb454', 10);
    g.strokeStyle = '#ffb454'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(w / 2, h / 2, 24, 8, -0.3, 0, Math.PI * 2); g.stroke();
    glowOff(g);
    g.fillStyle = '#000';
    dot(g, w / 2, h / 2, 11);
    glowOn(g, t.fg, 8);
    g.strokeStyle = t.fg; g.lineWidth = 1.5;
    g.beginPath(); g.arc(w / 2, h / 2, 12.5, 0, Math.PI * 2); g.stroke();
    glowOff(g);
  },
  infinityArt: (g, w, h, t) => {
    glowOn(g, t.fg, 9);
    g.strokeStyle = t.fg; g.lineWidth = 3.5; g.lineCap = 'round';
    g.beginPath();
    for (let a = 0; a < Math.PI * 2 + 0.1; a += 0.1) {
      const x = w / 2 + Math.sin(a) * 22;
      const y = h / 2 + Math.sin(a * 2) * 10;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    glowOff(g);
  },
  collapseArt: (g, w, h, t) => {
    glowOn(g, t.fg, 7);
    g.strokeStyle = t.fg; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x1 = w / 2 + Math.cos(a) * 26, y1 = h / 2 + Math.sin(a) * 22;
      const x2 = w / 2 + Math.cos(a) * 10, y2 = h / 2 + Math.sin(a) * 8;
      line(g, x1, y1, x2, y2);
      poly(g, [[x2, y2], [x2 + Math.cos(a + 2.6) * 5, y2 + Math.sin(a + 2.6) * 5], [x2 + Math.cos(a - 2.6) * 5, y2 + Math.sin(a - 2.6) * 5]]);
      g.fillStyle = t.fg; g.fill();
    }
    g.fillStyle = t.fg2;
    dot(g, w / 2, h / 2, 3);
    glowOff(g);
  },

  // ---------------------------------------------------------------- STATUS / CURSE
  glitchArt: (g, w, h, t) => {
    const rng2 = makeRng('glitch');
    for (let i = 0; i < 14; i++) {
      g.fillStyle = rng2.chance(0.5) ? t.fg : t.fg2;
      g.globalAlpha = 0.4 + rng2.next() * 0.6;
      g.fillRect(8 + rng2.next() * (w - 24), 8 + rng2.next() * (h - 18), 4 + rng2.next() * 10, 3 + rng2.next() * 5);
    }
    g.globalAlpha = 1;
  },
  breachArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2.5; g.lineJoin = 'round';
    poly(g, [[w / 2 - 2, 6], [w / 2 + 6, h * 0.35], [w / 2 - 5, h * 0.5], [w / 2 + 4, h * 0.7], [w / 2 - 3, h - 6]], false);
    g.stroke();
    g.strokeStyle = t.fg2; g.lineWidth = 1.5;
    line(g, w / 2 + 6, h * 0.35, w / 2 + 16, h * 0.42);
    line(g, w / 2 - 5, h * 0.5, w / 2 - 15, h * 0.58);
  },
  weightArt: (g, w, h, t) => {
    g.fillStyle = t.fg;
    g.beginPath(); g.arc(w / 2, h / 2 + 5, 15, 0, Math.PI * 2); g.fill();
    g.strokeStyle = t.fg; g.lineWidth = 4;
    g.beginPath(); g.arc(w / 2, h / 2 - 12, 6, Math.PI, 0); g.stroke();
    g.fillStyle = t.fg2;
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillText('∞', w / 2, h / 2 + 10);
  },
  corruptArt: (g, w, h, t) => {
    g.strokeStyle = t.fg; g.lineWidth = 2;
    g.strokeRect(w / 2 - 13, h / 2 - 17, 26, 34);
    line(g, w / 2 - 13, h / 2 - 17, w / 2 - 5, h / 2 - 17);
    g.strokeStyle = t.fg2; g.lineWidth = 3; g.lineCap = 'round';
    line(g, w / 2 - 7, h / 2 - 7, w / 2 + 7, h / 2 + 7);
    line(g, w / 2 + 7, h / 2 - 7, w / 2 - 7, h / 2 + 7);
  },
};

// per-card painter assignments — every card reads as its mechanics
const CARD_ART: Record<string, string> = {
  // starters / neutral
  pulse_laser: 'beam', shield_matrix: 'shieldArt', system_scan: 'scoutArt',
  salvage_claw: 'clawArt', scrap_converter: 'gearArt', emergency_vent: 'ventArt',
  overclock: 'cpuArt', protocol_override: 'cpuArt', probe_memory: 'memoryArt',
  corrosive_spores: 'naniteArt', genesis_echo: 'genesisArt',
  // laser
  focused_beam: 'beam', twin_beam: 'twinbeam', capacitor_tap: 'capacitorArt',
  blinding_flash: 'flashArt', refraction_arc: 'prismArt', searing_lock: 'lensArt',
  thermal_lens: 'lensArt', photon_veil: 'veilArt', microfocus_array: 'capacitorArt',
  prism_splitter: 'prismArt', lance_of_dawn: 'beam', coherence: 'flashArt',
  annihilation_ray: 'beam',
  // kinetic
  railshot: 'slugArt', flak_burst: 'flakArt', recoil_brace: 'braceArt',
  overpressure: 'springArt', slug_volley: 'volleyArt', piercing_round: 'slugArt',
  bunker_buster: 'cannonArt', kinetic_slug: 'punch', autoloader: 'gearArt',
  shock_absorbers: 'springArt', siege_cannon: 'cannonArt', gauss_engine: 'cpuArt',
  vera_mass_driver: 'cannonArt',
  // nuclear
  isotope_round: 'trefoilArt', fallout_vent: 'barrelArt', lead_shielding: 'braceArt',
  decay_burst: 'atomArt', containment_cell: 'reactorArt', gamma_lance: 'beam',
  enrich: 'atomArt', tactical_warhead: 'warheadArt', breeder_reactor: 'reactorArt',
  rad_eater: 'naniteArt', critical_mass: 'meltdownArt', meltdown: 'meltdownArt',
  atomic_engine: 'reactorArt',
  // speed
  microthrust: 'dashArt', strafing_run: 'wingArt', slipstream: 'dashArt',
  juke: 'wingArt', lookahead: 'scoutArt', afterburner: 'gaugeArt',
  hit_and_run: 'dashArt', saturation_fire: 'volleyArt', flicker_drive: 'skipArt',
  predictive_targeting: 'scoutArt', reaction_wheels: 'gearArt', redline_core: 'gaugeArt',
  phase_skip: 'skipArt',
  // repair
  patch_weld: 'wrenchArt', bulwark_plating: 'shieldArt', spot_welder: 'wrenchArt',
  reactive_mesh: 'thornsArt', nanite_cloud: 'naniteArt', fortify: 'shieldArt',
  auto_repair: 'wrenchArt', emergency_bulkhead: 'braceArt', hull_spikes: 'thornsArt',
  swarm_director: 'naniteArt', adaptive_alloy: 'healArt', persistent_shielding: 'shieldArt',
  total_reconstruction: 'healArt',
  // paradox
  causal_loop: 'spiralArt', future_echo: 'infinityArt', event_horizon: 'horizonArt',
  probability_collapse: 'collapseArt', time_dilation: 'hourglassArt', singularity_shard: 'horizonArt',
  // status / curse
  glitch: 'glitchArt', hull_breach: 'breachArt', corrupted_data: 'corruptArt', dead_weight: 'weightArt',
};

const ARCH_DEFAULT: Record<string, string> = {
  laser: 'beam', kinetic: 'punch', nuclear: 'trefoilArt', speed: 'dashArt',
  repair: 'wrenchArt', neutral: 'gearArt', paradox: 'spiralArt', status: 'glitchArt',
};

const artCache = new Map<string, string>();

/** Card art panel: drawn iconography, archetype-colored. Returns a dataURL. */
export function cardArt(cardId: string, archetype: string): string {
  const key = `${cardId}:${archetype}`;
  const cached = artCache.get(key);
  if (cached) return cached;

  const theme = THEMES[archetype] ?? THEMES['neutral']!;
  const W = 144, H = 90;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  // soft vertical gradient + vignette stars
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.bgTop);
  grad.addColorStop(1, theme.bgBot);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rng = makeRng('art:' + cardId);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) {
    g.globalAlpha = 0.12 + rng.next() * 0.3;
    dot(g, rng.next() * W, rng.next() * H, 0.5 + rng.next() * 0.8);
  }
  g.globalAlpha = 1;

  const painter = PAINTERS[CARD_ART[cardId] ?? ARCH_DEFAULT[archetype] ?? 'gearArt']!;
  painter(g, W, H, theme, rng);

  const url = c.toDataURL();
  artCache.set(key, url);
  return url;
}
