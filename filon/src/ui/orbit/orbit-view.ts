// orbit-view.ts — "Économie visible": the Crier seen from orbit, the hero panel of the Crier
// screen. Ysmère is an inked globe in orthographic projection, framed so the cirque sits a
// little up-left of the disc's centre; its night side follows the world day (sunDir: 36 epochs
// a day). The forty other claims (colonies) stand on it as little profile glyphs (lit windows at
// night; hidden on the far side), the player's Hearth marks the cirque, and the Crier Ring
// passes behind the planet and in front of it with its station. The player's trade shows as
// dashed great-circle routes lifted above the ground (coral: goods sold, turquoise: goods
// bought; thicker with the trade), every cargo lift as pods flying through the station, and
// the Gazette's colonies as pulsing rings. Hovering a colony, the cirque or the station shows
// a small tip (names, what it supplies and needs, the trade, its events).
//
// Canvas2D with the render art kit. The still layers are painted offscreen (paint.ts) on a
// resize — the sky and the far half of the ring with the day face, then the near half of the
// ring with the station — and the night when the sun moved a third of a degree; frame() blits
// them and draws only what moves. Nothing runs while the Crier is closed (no frame() then).
import { buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { COLONY_PROFILES, HOME_POSITION, type ColonyProfileId } from '@/content/colonies';
import { el, setAttr, setStyle } from '@/core/dom';
import { hash32 } from '@/core/hash';
import { credits } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import type { ColonyView, MarketEvent, MarketSnapshot } from '@/market/types';
import type { Atlas } from '@/render/art/atlas';
import type { Pt } from '@/render/art/ink';
import { C } from '@/render/art/tokens';
import { itemIcon } from '../build-bar';
import { eventLine } from '../gazette';
import { MAX_FLIGHTS, drawTrail, flightDone, makeFlight, stepFlight, type Flight } from './flights';
import { GLYPHS, HOME_GLYPH, stampBell, stampCraft, stampFlame, stampGlyph, type Stamp } from './glyphs';
import { DEG, NOON, angle, fromLatLon, greatArc, ringAt, ringFrame, shown, sunDir, toView, unit, viewFrame, type V3 } from './globe';
import { RING, paintNight, paintPlanet, paintRingHalf, paintSky, paintStation, px, stationAt, type Layout } from './paint';
import { makeStreaks, makeSurface } from './surface';

/** A cargo lift-off from one of the player's trade posts at an epoch boundary. */
export interface OrbitLift {
  /** Game tick of the boundary. */
  tick: number;
  soldMu: number;
  boughtMu: number;
  /** Colonies the bought goods come from (indices in snapshot.colonies). */
  from: readonly number[];
}

export interface OrbitData {
  snapshot: MarketSnapshot;
  /** Absolute world epoch now (day/night on the planet, the ring's turn). */
  epoch: number;
  /** Lifts since the previous call, oldest first. */
  lifts: readonly OrbitLift[];
}

/** Where we look from (degrees): south-east of the cirque (18° N, 0°), which sits up-left of the centre. */
const VIEW_LAT = 3, VIEW_LON = 9;
/** Trade under this (centi-◉ per minute) draws no route. */
const MIN_CPM = 5;
/** The night is repainted when the sun has moved this much. */
const NIGHT_STEP = 0.3 * DEG;
/** An epoch lasts a real minute: between two updates the terminator creeps on. */
const EPOCH_S = 60;
/** Lifts kept from a backlog (the screen was closed while the posts traded). */
const BACKLOG = 4;
/** Seconds between two pods leaving, so a burst of lifts strings out. */
const SLOT_S = 0.42;
/** One turn of the ring's lights (s). */
const RING_TURN_S = 110;
const TAU = Math.PI * 2;

const smooth = (a: number, b: number, v: number): number => {
  const k = a === b ? (v >= b ? 1 : 0) : Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

type Hover = { kind: 'colony'; idx: number } | { kind: 'home' } | { kind: 'station' };

interface ColonyPlace {
  readonly c: ColonyView;
  /** View-space position (unit vector). */
  readonly v: V3;
  /** Size factor of its glyph (from the colony's size). */
  readonly sf: number;
  x: number;
  y: number;
}

interface Route {
  readonly colony: number;
  readonly exp: number;
  readonly imp: number;
  readonly out: Path2D | null;
  readonly back: Path2D | null;
}

interface Pulse { x: number; y: number; t: number; dur: number; color: string; r0: number; r1: number }

interface Stamps {
  readonly day: ReadonlyMap<ColonyProfileId, Stamp>;
  readonly night: ReadonlyMap<ColonyProfileId, Stamp>;
  readonly home: readonly [Stamp, Stamp];
  readonly craft: Stamp;
  readonly flame: Stamp;
  readonly bell: Stamp;
  /** CSS px per glyph unit for a size-1 colony; pod length (CSS px). */
  readonly unit: number;
  readonly pod: number;
}

function cache(w: number, h: number, dpr: number, ox: number, oy: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * dpr));
  cv.height = Math.max(1, Math.ceil(h * dpr));
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return cv;
}

export class OrbitView {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tip: HTMLElement;
  private readonly ro: ResizeObserver | null;
  private readonly view = viewFrame(VIEW_LAT, VIEW_LON);
  private readonly ring = ringFrame(RING.open, RING.roll);
  private readonly surface = makeSurface();
  private readonly streaks = makeStreaks();
  private readonly home: V3;
  private stationV: V3 = [0, 0, 0];
  // Layout and caches.
  private cssW = 0;
  private cssH = 0;
  private L: Layout | null = null;
  private dirty = true;
  private back: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;
  private night: HTMLCanvasElement | null = null;
  private nightBox: readonly [number, number, number] = [0, 0, 0];
  private lastSun: V3 | null = null;
  private stamps: Stamps | null = null;
  private yoke: Pt = [0, 0];
  private beacon: Pt = [0, 0];
  private stationPx: Pt = [0, 0];
  private homePx: Pt = [0, 0];
  // Market data.
  private snap: MarketSnapshot | null = null;
  private places: ColonyPlace[] = [];
  private order: number[] = [];
  private placesKey = '';
  private routes: Route[] = [];
  private routesKey = '';
  private partners: number[] = [];
  private active = new Map<number, MarketEvent[]>();
  private announced = new Map<number, MarketEvent[]>();
  private worldEvents: MarketEvent[] = [];
  private epoch = NaN;
  private sinceEpoch = 0;
  // Animation.
  private time = 0;
  private flights: Flight[] = [];
  private nextSlot = 0;
  private pulses: Pulse[] = [];
  private bellAmp = 0;
  private bellPhase = 0;
  // Pointer and tip.
  private pointer: { x: number; y: number } | null = null;
  private hover: Hover | null = null;
  private tipSig = '';
  private lastFrame = 0;
  private frameMs = 0;

  constructor(readonly atlas: Atlas) {
    this.canvas = el<'canvas'>('canvas.orbit-canvas', { role: 'img' });
    this.g = this.canvas.getContext('2d')!;
    this.tip = el('div.orbit-tip.cartouche', { hidden: '' });
    this.root = el('div.orbit', { 'data-orbit': '' }, [this.canvas, this.tip]);
    this.home = toView(this.view, fromLatLon(HOME_POSITION.lat, HOME_POSITION.lon));
    this.ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      // A detached root reports 0 × 0: keep the caches for when the screen reopens.
      if (!r || r.width < 2 || r.height < 2) return;
      if (Math.abs(r.width - this.cssW) < 0.5 && Math.abs(r.height - this.cssH) < 0.5) return;
      this.cssW = r.width;
      this.cssH = r.height;
      this.dirty = true;
    });
    this.ro?.observe(this.root);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerleave', this.onLeave);
  }

  /** The latest market state (the screen calls it at 4 Hz). */
  setData(d: OrbitData): void {
    this.snap = d.snapshot;
    setAttr(this.canvas, 'aria-label', t('screen.market'));
    if (d.epoch !== this.epoch) { this.epoch = d.epoch; this.sinceEpoch = 0; }
    const key = `${d.snapshot.colonies.length}:${d.snapshot.colonies[0]?.key ?? ''}`;
    if (key !== this.placesKey) { this.placesKey = key; this.placeColonies(); }
    // Events by host colony (−1: world-wide, shown at the station).
    this.active.clear();
    this.announced.clear();
    this.worldEvents = [];
    for (const [list, map] of [[d.snapshot.events.active, this.active], [d.snapshot.events.announced, this.announced]] as const) {
      for (const ev of list) {
        if (ev.colony < 0) { this.worldEvents.push(ev); continue; }
        const l = map.get(ev.colony);
        if (l) l.push(ev); else map.set(ev.colony, [ev]);
      }
    }
    // Routes are rebuilt when their set or their weight class changes.
    const tr = d.snapshot.trade.filter((x) => x.exportCpm >= MIN_CPM || x.importCpm >= MIN_CPM);
    const rk = tr.map((x) => `${x.colony}:${Math.round(Math.log2(1 + x.exportCpm) * 2)}:${Math.round(Math.log2(1 + x.importCpm) * 2)}`).join(',');
    if (rk !== this.routesKey) { this.routesKey = rk; this.routes = []; }
    this.partners = tr.slice().sort((a, b) => b.exportCpm + b.importCpm - a.exportCpm - a.importCpm || a.colony - b.colony).slice(0, 3).map((x) => x.colony);
    const lifts = d.lifts.length > BACKLOG ? d.lifts.slice(-BACKLOG) : d.lifts;
    for (const l of lifts) this.launch(l);
    this.updateTip();
  }

  /** Every frame while the screen is open (animation). */
  frame(dt: number): void {
    // Back after the screen was closed: forget a hover the pointer has long left.
    const now = performance.now();
    if (now - this.lastFrame > 500 && this.hover) this.onLeave();
    this.lastFrame = now;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    this.sinceEpoch += dt;
    if (!this.layout()) return;
    const L = this.L!, g = this.g;
    const sun = toView(this.view, sunDir(this.epochNow()));
    if (!this.lastSun || angle(sun, this.lastSun) > NIGHT_STEP) this.paintNight(sun);
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.back!, 0, 0, L.w, L.h);
    const [nx, ny, nw] = this.nightBox;
    g.drawImage(this.night!, nx, ny, nw, nw);
    this.drawBeads(g, L, false);
    if (this.worldEvents.length) this.drawWorldPulse(g, L);
    this.drawRoutes(g, L);
    this.drawColonies(g, sun);
    this.drawHome(g, sun);
    this.drawPulses(g, dt);
    g.drawImage(this.front!, 0, 0, L.w, L.h);
    this.drawBeads(g, L, true);
    this.drawStation(g, L, dt);
    this.drawFlights(g, dt);
    this.drawLabels(g, L);
    this.drawHover(g);
    this.frameMs = performance.now() - now;
  }

  /** For tests and the perf overlay: pods in the air, routes drawn, colonies on the near side, the last frame's cost. */
  stats(): { flights: number; routes: number; colonies: number; frameMs: number } {
    return { flights: this.flights.length, routes: this.routes.length, colonies: this.places.filter((p) => p.v[2] > 0).length, frameMs: this.frameMs };
  }

  /** Free canvases / listeners. */
  destroy(): void {
    this.ro?.disconnect();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    for (const cv of [this.canvas, this.back, this.front, this.night]) if (cv) { cv.width = 0; cv.height = 0; }
    this.back = this.front = this.night = null;
    this.L = null;
    this.cssW = this.cssH = 0;
    this.stamps = null;
    this.flights = [];
    this.root.remove();
  }

  // ── time, layout and caches ──────────────────────────────────────────────

  /** The fractional world epoch shown (noon of day 0 before any data). */
  private epochNow(): number {
    return Number.isFinite(this.epoch) ? this.epoch + Math.min(this.sinceEpoch / EPOCH_S, 0.98) : NOON;
  }

  /** (Re)build the layout and the still layers after a resize or a DPR change; false while there is no size. */
  private layout(): boolean {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.L && dpr !== this.L.dpr) this.dirty = true;
    if (this.cssW < 2 || this.cssH < 2) return false;
    if (!this.dirty && this.L) return true;
    this.dirty = false;
    const w = this.cssW, h = this.cssH;
    // As big as the panel allows; a narrow panel crops the ring's ends (stationAt keeps the station in).
    const R = Math.max(30, Math.min(h * 0.42, w * 0.4));
    const L: Layout = { w, h, cx: w / 2, cy: h / 2 + R * 0.05, R, dpr };
    this.L = L;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.back = cache(w, h, dpr, 0, 0, (g) => {
      paintSky(g, L, 41);
      paintRingHalf(g, L, this.ring, 'back');
      paintPlanet(g, L, this.view, this.surface, this.streaks);
    });
    this.front = cache(w, h, dpr, 0, 0, (g) => {
      paintRingHalf(g, L, this.ring, 'front');
      const st = paintStation(g, L, this.ring, 7);
      this.yoke = st.yoke;
      this.beacon = st.beacon;
    });
    this.stationV = stationAt(L, this.ring).p;
    this.stationPx = px(L, this.stationV);
    this.homePx = px(L, this.home);
    // Glyph sizes follow the planet: a size-1 colony stands ~8.5 % of its radius.
    const gh = Math.min(28, Math.max(13, R * 0.09));
    const unit = gh / 44, pod = Math.min(24, Math.max(12, R * 0.085));
    const k = unit * 1.2 * dpr;
    const day = new Map<ColonyProfileId, Stamp>(), night = new Map<ColonyProfileId, Stamp>();
    for (const [p, gl] of Object.entries(GLYPHS) as Array<[ColonyProfileId, (typeof GLYPHS)[ColonyProfileId]]>) {
      day.set(p, stampGlyph(gl, k, false, 17));
      night.set(p, stampGlyph(gl, k, true, 17));
    }
    const hk = unit * 1.15 * dpr;
    this.stamps = {
      day, night, unit, pod,
      home: [stampGlyph(HOME_GLYPH, hk, false, 23), stampGlyph(HOME_GLYPH, hk, true, 23)],
      craft: stampCraft(pod * 1.3 * dpr),
      flame: stampFlame(pod * 1.3 * dpr),
      bell: stampBell(stationAt(L, this.ring).s * 0.42 * dpr),
    };
    this.lastSun = null;
    this.routes = []; // rebuilt at the next draw for the new layout
    this.placeColonies();
    return true;
  }

  /** Repaint the night layer (the planet's box only), reusing its canvas while the size holds. */
  private paintNight(sun: V3): void {
    const L = this.L!;
    const r = L.R * 1.12, x = L.cx - r, y = L.cy - r, w = 2 * r;
    const side = Math.max(1, Math.ceil(w * L.dpr));
    this.nightBox = [x, y, w];
    if (this.night && this.night.width === side) {
      const g = this.night.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, side, side);
      g.setTransform(L.dpr, 0, 0, L.dpr, -x * L.dpr, -y * L.dpr);
      paintNight(g, L, sun);
    } else {
      this.night = cache(w, w, L.dpr, x, y, (g) => paintNight(g, L, sun));
    }
    this.lastSun = sun;
  }

  /** Colonies in view space and on screen, drawn back (high on screen) to front. */
  private placeColonies(): void {
    const cols = this.snap?.colonies ?? [];
    const L = this.L;
    this.places = cols.map((c) => {
      const v = toView(this.view, fromLatLon(c.lat, c.lon));
      const [x, y] = L ? px(L, v) : [0, 0];
      return { c, v, sf: 0.85 + 0.5 * Math.min(0.6, Math.max(0, c.size - 0.7)), x, y };
    });
    this.order = this.places.map((_, i) => i).sort((a, b) => this.places[a]!.y - this.places[b]!.y || a - b);
  }

  // ── lifts → flights ──────────────────────────────────────────────────────

  private launch(l: OrbitLift): void {
    const snap = this.snap;
    if (!snap || !this.places.length) return;
    if (l.soldMu > 0) {
      const n = l.soldMu >= 200_000 ? 3 : l.soldMu >= 50_000 ? 2 : 1;
      for (const b of this.buyers(snap, l.tick, n)) this.spawn('sell', -1, b);
    }
    if (l.boughtMu > 0) {
      const from = [...new Set(l.from)].filter((i) => i >= 0 && i < this.places.length).slice(0, 3);
      if (!from.length) from.push(this.nearest(l.tick));
      for (const c of from) this.spawn('buy', c, -1);
    }
  }

  /** Buying colonies for a sale: weighted by the player's export trade, drawn from the lift's tick. */
  private buyers(snap: MarketSnapshot, tick: number, n: number): number[] {
    const pool = snap.trade.filter((x) => x.exportCpm > 0 && x.colony < this.places.length).map((x) => [x.colony, x.exportCpm] as [number, number]);
    const out: number[] = [];
    for (let k = 0; k < n && pool.length; k++) {
      let r = (hash32(tick | 0, 0x5e11, k) / 4294967296) * pool.reduce((s, e) => s + e[1], 0);
      let i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i]![1]; if (r <= 0) break; }
      out.push(pool[i]![0]);
      pool.splice(i, 1);
    }
    if (!out.length) out.push(this.nearest(tick));
    return out;
  }

  /** One of the eight nearest colonies, drawn from the tick (no trade on record yet). */
  private nearest(tick: number): number {
    const near = this.places.map((p, i) => [i, p.c.arc] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 8);
    return near[hash32(tick | 0, 0x5e12) % near.length]![0];
  }

  private spawn(kind: 'sell' | 'buy', origin: number, dest: number): void {
    if (this.flights.length >= MAX_FLIGHTS) return;
    const a = origin < 0 ? this.home : this.places[origin]!.v;
    const b = dest < 0 ? this.home : this.places[dest]!.v;
    const delay = Math.max(0, this.nextSlot - this.time);
    this.nextSlot = Math.max(this.time, this.nextSlot) + SLOT_S;
    this.flights.push(makeFlight(kind, origin, dest, a, b, this.stationV, delay));
  }

  // ── live layers ──────────────────────────────────────────────────────────

  /** The ring's turning lights: the far ones only where they clear the planet's disc. */
  private drawBeads(g: CanvasRenderingContext2D, L: Layout, near: boolean): void {
    const n = 40, turn = (this.time / RING_TURN_S) * TAU;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU + turn;
      const p = ringAt(this.ring, th, RING.r + RING.w * 0.62);
      if ((p[2] >= 0) !== near || (!near && !shown(p))) continue;
      const [x, y] = px(L, p);
      const warm = i % 4 === 0;
      g.globalAlpha = near ? 0.35 : 0.2;
      g.fillStyle = warm ? C.ledWarm : C.led;
      g.beginPath();
      g.arc(x, y, 2.6, 0, TAU);
      g.fill();
      g.globalAlpha = near ? 1 : 0.6;
      g.beginPath();
      g.arc(x, y, 1.05, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** A world-wide event: the atmosphere breathes a warm ring. */
  private drawWorldPulse(g: CanvasRenderingContext2D, L: Layout): void {
    const k = 0.5 + 0.5 * Math.sin(this.time * 1.6);
    g.strokeStyle = C.warn;
    g.globalAlpha = 0.25 + 0.3 * k;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(L.cx, L.cy, L.R * (1.075 + 0.012 * k), 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }

  /** Build the routes' paths: one great circle each way, lifted, only its shown parts. */
  private buildRoutes(L: Layout): void {
    const snap = this.snap;
    if (!snap) return;
    // A route starts (or ends) a little off the cirque, so the Hearth is not lost in a knot of ink.
    const clear = 3.2 * DEG;
    const path = (pts: V3[]): Path2D | null => {
      const p = new Path2D();
      let any = false, open = false;
      for (const v of pts) {
        if (!shown(v) || angle(this.home, unit(v)) < clear) { open = false; continue; }
        const [x, y] = px(L, v);
        if (open) p.lineTo(x, y); else { p.moveTo(x, y); open = true; any = true; }
      }
      return any ? p : null;
    };
    this.routes = snap.trade.filter((x) => (x.exportCpm >= MIN_CPM || x.importCpm >= MIN_CPM) && x.colony < this.places.length).map((x) => {
      const c = this.places[x.colony]!.v;
      const span = angle(this.home, c);
      const n = Math.max(14, Math.ceil(span / (1.6 * DEG)));
      const peak = 0.035 + 0.11 * (span / Math.PI);
      return {
        colony: x.colony, exp: x.exportCpm, imp: x.importCpm,
        out: x.exportCpm >= MIN_CPM ? path(greatArc(this.home, c, peak, n)) : null,
        back: x.importCpm >= MIN_CPM ? path(greatArc(c, this.home, peak * 0.62, n)) : null,
      };
    });
  }

  /**
   * The routes, thicker and bolder with the trade (≈ log of ◉/min): a faint inked track, then
   * dashes flowing out (coral, goods sold) or home (turquoise, goods bought). The big routes'
   * dashes are inked; a trickle is a thin coloured dotted line.
   */
  private drawRoutes(g: CanvasRenderingContext2D, L: Layout): void {
    if (!this.routes.length && this.routesKey) this.buildRoutes(L);
    if (!this.routes.length) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const r of this.routes) {
      for (const [p, cpm, color] of [[r.out, r.exp, C.coral], [r.back, r.imp, C.turqL]] as const) {
        if (!p) continue;
        const w = Math.min(5, 0.7 + 1.25 * Math.log10(1 + cpm / 40));
        const bold = smooth(80, 900, cpm);
        g.setLineDash([]);
        g.strokeStyle = C.ink;
        g.globalAlpha = 0.12 + 0.12 * bold;
        g.lineWidth = 0.8;
        g.stroke(p);
        g.setLineDash([2.5 + w * 1.5, 3 + w * 1.7]);
        g.lineDashOffset = -this.time * (10 + w * 3);
        if (bold > 0) {
          g.strokeStyle = C.ink;
          g.globalAlpha = 0.9 * bold;
          g.lineWidth = w + 1.8;
          g.stroke(p);
        }
        g.strokeStyle = color;
        g.globalAlpha = 0.6 + 0.4 * bold;
        g.lineWidth = w;
        g.stroke(p);
      }
    }
    g.restore();
  }

  private drawColonies(g: CanvasRenderingContext2D, sun: V3): void {
    const st = this.stamps;
    if (!st) return;
    for (const i of this.order) {
      const p = this.places[i];
      if (!p || p.v[2] <= 0) continue;
      const fade = smooth(0, 0.28, p.v[2]);
      const s = st.unit * p.sf * (0.78 + 0.22 * fade);
      const nightK = smooth(0.05, -0.07, p.v[0] * sun[0] + p.v[1] * sun[1] + p.v[2] * sun[2]);
      // Events first, under the glyph: pulsing rings while one runs (coral when demand is up, a
      // shortage; lilac when supply is, a glut or a caravan), a turning dashed ring when announced.
      const gh = 44 * s;
      const cy = p.y - gh * 0.42;
      const act = this.active.get(i);
      if (act) {
        const color = act.some((e) => e.side === 'demand') ? C.coral : C.lilacL;
        for (const ph of [0, 0.5]) {
          const k = (this.time * 0.7 + ph) % 1;
          g.strokeStyle = color;
          g.globalAlpha = fade * 0.9 * (1 - k);
          g.lineWidth = 2.2 * (1 - k) + 0.6;
          g.beginPath();
          g.arc(p.x, cy, gh * (0.55 + 0.9 * k), 0, TAU);
          g.stroke();
        }
      } else if (this.announced.has(i)) {
        g.save();
        g.strokeStyle = C.warn;
        g.globalAlpha = fade * (0.6 + 0.3 * Math.sin(this.time * 2.4));
        g.lineWidth = 1.6;
        g.setLineDash([3, 3.5]);
        g.lineDashOffset = -this.time * 6;
        g.beginPath();
        g.arc(p.x, cy, gh * 0.72, 0, TAU);
        g.stroke();
        g.restore();
      }
      if (nightK > 0) {
        // A city glow on the night side.
        g.fillStyle = C.glowPeach;
        g.globalAlpha = 0.16 * nightK * fade;
        g.beginPath();
        g.arc(p.x, p.y - gh * 0.3, gh * 0.75, 0, TAU);
        g.fill();
      }
      for (const [stamp, a] of [[st.day.get(p.c.profile), 1 - nightK], [st.night.get(p.c.profile), nightK]] as const) {
        if (!stamp || a <= 0.01) continue;
        const sc = s / stamp.k;
        g.globalAlpha = a * fade;
        g.drawImage(stamp.cv, p.x - stamp.ax * sc, p.y - stamp.ay * sc, stamp.cv.width * sc, stamp.cv.height * sc);
      }
    }
    g.globalAlpha = 1;
  }

  /** The Hearth on the cirque, with a slow turquoise "here" ring. */
  private drawHome(g: CanvasRenderingContext2D, sun: V3): void {
    const st = this.stamps;
    if (!st) return;
    const [x, y] = this.homePx;
    const s = st.unit * 1.25;
    // A pale clearing under the Hearth, then a slow turquoise "here" ring spreading on the ground.
    g.fillStyle = C.paper;
    g.globalAlpha = 0.45;
    g.beginPath();
    g.ellipse(x, y - 2, 30 * s, 14 * s, 0, 0, TAU);
    g.fill();
    for (const ph of [0, 0.5]) {
      const k = (this.time / 3.2 + ph) % 1;
      const rx = 22 * s + 60 * s * k;
      g.strokeStyle = C.turqL;
      g.globalAlpha = 0.9 * (1 - k);
      g.lineWidth = 2.4 * (1 - k) + 0.8;
      g.beginPath();
      g.ellipse(x, y - 2, rx, rx * 0.45, 0, 0, TAU);
      g.stroke();
    }
    const h = this.home;
    const nightK = smooth(0.05, -0.07, h[0] * sun[0] + h[1] * sun[1] + h[2] * sun[2]);
    for (const [stamp, a] of [[st.home[0], 1 - nightK], [st.home[1], nightK]] as const) {
      if (a <= 0.01) continue;
      const sc = s / stamp.k;
      g.globalAlpha = a;
      g.drawImage(stamp.cv, x - stamp.ax * sc, y - stamp.ay * sc, stamp.cv.width * sc, stamp.cv.height * sc);
    }
    g.globalAlpha = 1;
  }

  private drawPulses(g: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.t += dt;
      if (p.t >= p.dur) { this.pulses.splice(i, 1); continue; }
      const k = p.t / p.dur;
      g.strokeStyle = p.color;
      g.globalAlpha = 1 - k;
      g.lineWidth = 2.4 * (1 - k) + 0.5;
      g.beginPath();
      g.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * Math.sqrt(k), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** The station's live parts: the beacon blinking, the bell swinging after a docking. */
  private drawStation(g: CanvasRenderingContext2D, L: Layout, dt: number): void {
    const st = this.stamps;
    if (!st) return;
    const on = (this.time % 1.6) < 0.5;
    const [bx, by] = this.beacon;
    g.fillStyle = C.ledRed;
    g.globalAlpha = on ? 0.35 : 0.1;
    g.beginPath();
    g.arc(bx, by, Math.max(3, L.R * 0.022), 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    this.bellPhase += dt * 9;
    this.bellAmp *= Math.exp(-dt * 1.4);
    const b = st.bell, sc = 1 / L.dpr;
    g.save();
    g.translate(this.yoke[0], this.yoke[1]);
    g.rotate(this.bellAmp * Math.sin(this.bellPhase));
    g.drawImage(b.cv, -b.ax * sc, -b.ay * sc, b.cv.width * sc, b.cv.height * sc);
    g.restore();
  }

  private drawFlights(g: CanvasRenderingContext2D, dt: number): void {
    const st = this.stamps, L = this.L;
    if (!st || !L) return;
    const toPx = (p: V3): Pt => px(L, p);
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]!;
      const ev = stepFlight(f, dt, toPx);
      if (ev === 'dock') {
        this.bellAmp = Math.min(0.55, this.bellAmp + 0.32);
        const [sx, sy] = this.stationPx;
        this.pulses.push({ x: sx, y: sy, t: 0, dur: 0.9, color: C.brassL, r0: 4, r1: L.R * 0.16 });
      } else if (ev === 'land') {
        const at = f.dest < 0 ? this.homePx : ([this.places[f.dest]?.x ?? 0, this.places[f.dest]?.y ?? 0] as Pt);
        const v = f.dest < 0 ? this.home : this.places[f.dest]?.v;
        if (v && v[2] > 0) this.pulses.push({ x: at[0], y: at[1] - 4, t: 0, dur: 1.1, color: f.kind === 'sell' ? C.coral : C.turqL, r0: 3, r1: st.pod * 1.6 });
      }
      if (flightDone(f)) { this.flights.splice(i, 1); continue; }
    }
    for (const f of this.flights) drawTrail(g, f, st.pod);
    for (const f of this.flights) {
      if (!f.vis) continue;
      const u = st.pod * (0.85 + 0.3 * Math.min(1, Math.max(0, f.z / 1.6)));
      const sc = u / (st.pod * 1.3 * L.dpr);
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.ang);
      g.translate(0, u * 0.5);
      const fl = st.flame, fk = 0.75 + 0.25 * Math.sin(this.time * 37 + f.tUp * 50);
      g.drawImage(fl.cv, -fl.ax * sc, -fl.ay * sc, fl.cv.width * sc, fl.cv.height * sc * fk);
      const cr = st.craft;
      g.drawImage(cr.cv, -cr.ax * sc, -cr.ay * sc, cr.cv.width * sc, cr.cv.height * sc);
      g.restore();
    }
  }

  /** Names of the top trade partners, on small paper tags. */
  private drawLabels(g: CanvasRenderingContext2D, L: Layout): void {
    const st = this.stamps;
    if (!st || !this.partners.length) return;
    const loc = locale();
    g.font = `${Math.round(Math.min(15, Math.max(11, L.R * 0.05)))}px "Patrick Hand SC", "Comic Sans MS", sans-serif`;
    g.textBaseline = 'middle';
    for (const i of this.partners) {
      const p = this.places[i];
      if (!p || p.v[2] < 0.12 || (this.hover?.kind === 'colony' && this.hover.idx === i)) continue;
      const name = p.c.name[loc];
      const tw = g.measureText(name).width;
      const gh = 44 * st.unit * p.sf;
      // On the side away from the cirque, so the tags don't pile up over the Hearth.
      const right = p.x >= this.homePx[0];
      let x = right ? p.x + gh * 0.45 : p.x - gh * 0.45 - tw - 10;
      const y = p.y - gh * 0.55;
      if (x + tw + 12 > L.w) x = p.x - gh * 0.45 - tw - 10;
      if (x < 2) x = p.x + gh * 0.45;
      g.globalAlpha = 0.92;
      g.fillStyle = C.paper;
      g.strokeStyle = C.ink;
      g.lineWidth = 1.2;
      g.beginPath();
      g.roundRect(x, y - 8, tw + 10, 16, 5);
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = C.ink;
      g.fillText(name, x + 5, y + 0.5);
    }
  }

  private drawHover(g: CanvasRenderingContext2D): void {
    const h = this.hover, st = this.stamps;
    if (!h || !st) return;
    const [x, y, r] = this.hoverRing(h, st);
    g.save();
    g.strokeStyle = C.paper;
    g.lineWidth = 3.2;
    g.setLineDash([4, 3]);
    g.lineDashOffset = -this.time * 8;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = 1.3;
    g.stroke();
    g.restore();
  }

  private hoverRing(h: Hover, st: Stamps): [number, number, number] {
    if (h.kind === 'home') return [this.homePx[0], this.homePx[1] - 26 * st.unit, 38 * st.unit];
    if (h.kind === 'station') return [this.stationPx[0], this.stationPx[1] - (this.L?.R ?? 0) * 0.07, (this.L?.R ?? 0) * 0.2];
    const p = this.places[h.idx]!;
    const gh = 44 * st.unit * p.sf;
    return [p.x, p.y - gh * 0.42, gh * 0.62];
  }

  // ── pointer and tip ──────────────────────────────────────────────────────

  private readonly onMove = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.hover = this.pick(this.pointer.x, this.pointer.y);
    setAttr(this.root, 'data-hover', this.hover ? '' : null);
    this.updateTip();
  };

  private readonly onLeave = (): void => {
    this.pointer = null;
    this.hover = null;
    setAttr(this.root, 'data-hover', null);
    this.updateTip();
  };

  /** What is under the pointer: the nearest visible colony glyph, the cirque, or the station. */
  private pick(x: number, y: number): Hover | null {
    const st = this.stamps, L = this.L;
    if (!st || !L) return null;
    let best: Hover | null = null, bd = Infinity;
    const test = (h: Hover, cx: number, cy: number, r: number): void => {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r && d < bd) { bd = d; best = h; }
    };
    for (let i = 0; i < this.places.length; i++) {
      const p = this.places[i]!;
      if (p.v[2] < 0.08) continue;
      const gh = 44 * st.unit * p.sf;
      test({ kind: 'colony', idx: i }, p.x, p.y - gh * 0.42, Math.max(9, gh * 0.55));
    }
    test({ kind: 'home' }, this.homePx[0], this.homePx[1] - 26 * st.unit, 30 * st.unit);
    test({ kind: 'station' }, this.stationPx[0], this.stationPx[1] - L.R * 0.07, L.R * 0.19);
    return best;
  }

  /** Show, fill and place the tip (its DOM is rebuilt only when what it says changes). */
  private updateTip(): void {
    const h = this.hover, pt = this.pointer;
    if (!h || !pt || !this.snap) {
      if (!this.tip.hidden) this.tip.hidden = true;
      this.tipSig = '';
      return;
    }
    const sig = JSON.stringify([h, locale(), this.tradeFor(h).map((v) => Math.round(v / 10)), this.eventsFor(h).map((e) => [e.id, e.start <= this.snap!.epoch])]);
    if (sig !== this.tipSig) {
      this.tipSig = sig;
      this.tip.replaceChildren(...this.tipContent(h));
    }
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let x = pt.x + 16, y = pt.y + 18;
    if (x + tw > this.cssW - 4) x = Math.max(4, pt.x - tw - 12);
    if (y + th > this.cssH - 4) y = Math.max(4, pt.y - th - 12);
    setStyle(this.tip, 'transform', `translate(${Math.round(x)}px, ${Math.round(y)}px)`);
  }

  /** [exported, imported] centi-◉ per minute for a hover target. */
  private tradeFor(h: Hover): [number, number] {
    const tr = this.snap?.trade ?? [];
    if (h.kind === 'colony') {
      const x = tr.find((e) => e.colony === h.idx);
      return [x?.exportCpm ?? 0, x?.importCpm ?? 0];
    }
    if (h.kind === 'home') return [tr.reduce((s, e) => s + e.exportCpm, 0), tr.reduce((s, e) => s + e.importCpm, 0)];
    return [0, 0];
  }

  private eventsFor(h: Hover): MarketEvent[] {
    if (h.kind === 'colony') return [...(this.active.get(h.idx) ?? []), ...(this.announced.get(h.idx) ?? [])];
    if (h.kind === 'station') return this.worldEvents;
    return [];
  }

  private tipContent(h: Hover): HTMLElement[] {
    const L = locale(), snap = this.snap!;
    const kids: HTMLElement[] = [];
    if (h.kind === 'colony') {
      const c = this.places[h.idx]!.c;
      const icon = this.glyphIcon(c.profile);
      kids.push(el('div.orbit-tip-head', {}, [icon, el('div', {}, [el('div.orbit-tip-title.lettering', {}, c.name[L]), el('div.orbit-tip-sub', {}, COLONY_PROFILES[c.profile].name[L])])]));
      kids.push(this.itemRow(t('stats.supply'), c.supplies, 'supply', c.unique));
      kids.push(this.itemRow(t('stats.demand'), c.needs, 'need', null));
    } else if (h.kind === 'home') {
      kids.push(el('div.orbit-tip-title.lettering', {}, buildingDef(buildingIdx('hearth')).name[L]));
    } else {
      kids.push(el('div.orbit-tip-title.lettering', {}, t('screen.market')));
    }
    const [exp, imp] = this.tradeFor(h);
    if (exp >= MIN_CPM || imp >= MIN_CPM) {
      kids.push(el('div.orbit-tip-trade', {}, [
        exp >= MIN_CPM ? el('span', { 'data-side': 'sell' }, `↗ ${t('hud.perMin', { v: credits(exp) })}`) : null,
        imp >= MIN_CPM ? el('span', { 'data-side': 'buy' }, `↙ ${t('hud.perMin', { v: credits(imp) })}`) : null,
      ]));
    }
    for (const ev of this.eventsFor(h)) {
      kids.push(el('div.orbit-tip-ev', { 'data-state': ev.start <= snap.epoch ? 'active' : 'announced' }, eventLine(ev, snap.colonies)));
    }
    return kids;
  }

  private itemRow(label: string, items: readonly string[], side: 'supply' | 'need', unique: string | null): HTMLElement {
    const L = locale();
    return el('div.orbit-tip-row', { 'data-side': side }, [
      el('span.orbit-tip-label', {}, label),
      el('span.orbit-tip-items', {}, items.map((id) => {
        const i = itemIdx(id);
        return el('span.orbit-tip-chip', { 'data-unique': id === unique ? '' : null }, [itemIcon(this.atlas, i, 16), itemDef(i).name[L]]);
      })),
    ]);
  }

  /** A small copy of a profile's day glyph for the tip. */
  private glyphIcon(p: ColonyProfileId): HTMLCanvasElement {
    const cv = el<'canvas'>('canvas.orbit-tip-glyph');
    const st = this.stamps?.day.get(p);
    if (st) {
      cv.width = st.cv.width;
      cv.height = st.cv.height;
      cv.getContext('2d')!.drawImage(st.cv, 0, 0);
    }
    return cv;
  }
}
