// terrain-chunks.ts — streams painted terrain chunks around the camera. Chunk textures are
// top-down and live in TILE units on the view's ground plane (the layer carries the view
// projection, so the same texture serves the iso and the plan view). Two kinds per chunk:
// the ground ('g', both views), the relief paint ('r', iso only, capped resolution) and the rock's
// sun shadows ('s', iso only, low resolution, under the relief: painted for the sun of the moment,
// `setSun`, kept per sun position; the old one stays up until the new one is painted). Each visible chunk shows the best
// texture available (a lower bucket, or a flat placeholder) while the right one paints in
// the worker; an LRU keeps VRAM bounded. Re-painted when the sim marks a chunk dirty: a
// chunk's paint reads 7 tiles around it, so its 8 neighbours repaint too, and a version per
// chunk discards paints that were in flight when the land changed. A failed or lost paint is
// retried after a pause instead of blocking the queue. There is no fog over it (D148): every chunk
// in view is painted, near the camera first.
import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { CHUNK, CHUNKS } from '@/sim/constants';
import type { Grid } from '@/sim/world/grid';
import { buildWindow, hasRock } from '../art/terrain';
import type { PaintReply, PaintRequest } from '../art/terrain.worker';
import type { CamState } from '../camera-math';
import { reliefHead, visibleChunksP, invert, apply, type Lin } from '../projection';
import { MAX_LEVEL } from '../relief';
import { C, num } from '../art/tokens';

type Kind = 'g' | 'r' | 's';
/** The sun shadows' resolution (texels per tile): soft, low-frequency. */
const SUN_PPT = 16;
/** Sun steps (per relief level, tiles): a new shadow paint each 1/32 of a tile per level the shadow moves. */
const SUN_Q = 32;
const BUCKETS = [8, 16, 32, 64] as const;
const RELIEF_MAX = 32;
const BUDGET = 256 * 1024 * 1024;
const MAX_IN_FLIGHT = 3;
/** Frames before a paint with no answer is given up, and before a failed one is retried. */
const LOST_FRAMES = 600;
const RETRY_FRAMES = 120;

interface Entry { tex: Texture | null; bytes: number; used: number }

export class TerrainChunks {
  private readonly cache = new Map<string, Entry>(); // `${kind}:${ck}:${ppt}`
  private readonly shown = new Map<string, { sprite: Sprite; key: string }>(); // `${kind}:${ck}`
  /** Paints posted to the worker: the chunk version and the frame they were sent at. */
  private readonly inflight = new Map<string, { ver: number; at: number }>();
  /** Per chunk: bumped when its land changes (paints of an older version are stale). */
  private readonly ver = new Map<number, number>();
  /** Keys that failed: not requested again before this frame. */
  private readonly retryAt = new Map<string, number>();
  private queue: Array<{ key: string; kind: Kind; ck: number; ppt: number; d2: number; sun?: string }> = [];
  /** The sun the shadows are painted for (tiles per relief level, quantised) and its key; their layer under the relief paint. */
  private sun: [number, number] = [0.42, 0];
  private sunKey = '13,0';
  private readonly sunLayer = new Container({ label: 'sunShadows' });
  private bytes = 0;
  private frame = 0;
  readonly missing = { count: 0 };
  /** Chunks currently in view (shared with the relief view). */
  visible: Array<[number, number]> = [];

  constructor(
    private readonly groundLayer: Container,
    private readonly reliefLayer: Container,
    private readonly grid: Grid,
    private readonly worker: Worker,
  ) {
    reliefLayer.addChildAt(this.sunLayer, 0);
    worker.onmessage = (e: MessageEvent) => {
      const { key, bitmap, error } = e.data as PaintReply;
      const sent = this.inflight.get(key);
      this.inflight.delete(key);
      const ck = Number(key.split(':')[1]);
      // Lost (timed out) or painted from land that has changed since: drop it.
      if (!sent || sent.ver !== (this.ver.get(ck) ?? 0)) { bitmap?.close(); return; }
      if (error) { this.retryAt.set(key, this.frame + RETRY_FRAMES); console.warn(`terrain paint ${key}: ${error}`); return; }
      if (!bitmap) { this.cache.set(key, { tex: null, bytes: 0, used: this.frame }); return; }
      const tex = new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
      const bytes = bitmap.width * bitmap.height * 4;
      this.cache.set(key, { tex, bytes, used: this.frame });
      this.bytes += bytes;
      this.evict();
    };
  }

  /**
   * The land of a chunk changed: it and its 8 neighbours (whose paint border reads it) are
   * repainted — cached textures of both kinds dropped, paints in flight made stale.
   */
  invalidate(ck: number): void {
    const cx = ck % CHUNKS, cy = Math.floor(ck / CHUNKS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= CHUNKS || ny >= CHUNKS) continue;
        const k = ny * CHUNKS + nx;
        this.ver.set(k, (this.ver.get(k) ?? 0) + 1);
        for (const kind of ['g', 'r'] as const) {
          for (const ppt of BUCKETS) {
            const key = `${kind}:${k}:${ppt}`;
            const e = this.cache.get(key);
            if (e) this.drop(key, e);
            this.retryAt.delete(key);
          }
        }
        for (const [key, e] of [...this.cache]) if (key.startsWith(`s:${k}:`)) this.drop(key, e);
      }
    }
  }

  private drop(key: string, e: Entry): void {
    this.cache.delete(key);
    this.bytes -= e.bytes;
    for (const [sk, s] of this.shown) if (s.key === key) { s.sprite.destroy(); this.shown.delete(sk); }
    e.tex?.destroy(true);
  }

  private evict(): void {
    if (this.bytes <= BUDGET) return;
    const visible = new Set([...this.shown.values()].map((s) => s.key));
    const lru = [...this.cache.entries()].filter(([k, e]) => e.tex && !visible.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of lru) {
      if (this.bytes <= BUDGET * 0.85) break;
      this.drop(k, e);
    }
  }

  private request(kind: Kind, ck: number, ppt: number, d2: number): void {
    const key = this.keyOf(kind, ck, ppt);
    if (this.inflight.has(key) || this.cache.has(key) || this.queue.some((q) => q.key === key)) return;
    if ((this.retryAt.get(key) ?? 0) > this.frame) return;
    this.queue.push({ key, kind, ck, ppt, d2, sun: kind === 's' ? this.sunKey : undefined });
  }

  /** A texture's cache key: kind, chunk, bucket — and for the shadows the sun they are painted for. */
  private keyOf(kind: Kind, ck: number, ppt: number): string {
    return kind === 's' ? `s:${ck}:${ppt}:${this.sunKey}` : `${kind}:${ck}:${ppt}`;
  }

  /**
   * The sun the rock's shadows fall from: (dx, dy) tiles per relief level on the ground, and how
   * dark they show (the day's: none at night). A move of a 32nd of a tile per level repaints them.
   */
  setSun(dx: number, dy: number, alpha: number): void {
    const qx = Math.round(dx * SUN_Q), qy = Math.round(dy * SUN_Q);
    this.sunKey = `${qx},${qy}`;
    this.sun = [qx / SUN_Q, qy / SUN_Q];
    this.sunLayer.alpha = alpha;
    this.sunLayer.visible = alpha > 0.01;
  }

  private pump(): void {
    // A paint that never answered (a dead worker task) frees its slot; its key may be asked again.
    for (const [k, f] of this.inflight) if (this.frame - f.at > LOST_FRAMES) { this.inflight.delete(k); this.retryAt.set(k, this.frame + RETRY_FRAMES); }
    if (this.inflight.size >= MAX_IN_FLIGHT || !this.queue.length) return;
    this.queue.sort((a, b) => a.d2 - b.d2 || a.ppt - b.ppt);
    while (this.inflight.size < MAX_IN_FLIGHT && this.queue.length) {
      const q = this.queue.shift()!;
      const cx = q.ck % CHUNKS, cy = Math.floor(q.ck / CHUNKS);
      const d = buildWindow((x, y) => this.grid.chunkAt(x, y), cx, cy, CHUNKS * CHUNK);
      if (q.kind !== 'g' && !hasRock(d)) { this.cache.set(q.key, { tex: null, bytes: 0, used: this.frame }); continue; }
      const req: PaintRequest = { ...d, key: q.key, ppt: q.ppt, kind: q.kind, sun: q.kind === 's' ? this.sun : undefined };
      this.inflight.set(q.key, { ver: this.ver.get(q.ck) ?? 0, at: this.frame });
      this.worker.postMessage(req, [d.terrain.buffer, d.ore.buffer, d.rich.buffer, d.height.buffer, d.biome.buffer, d.level.buffer]);
    }
  }

  /** Show the best available texture of one kind for a chunk; queue the right one. */
  private show(kind: Kind, ck: number, cx: number, cy: number, ppt: number, d2: number): void {
    const key = this.keyOf(kind, ck, ppt);
    const sk = `${kind}:${ck}`;
    let entry = this.cache.get(key);
    let useKey = key, usePpt: number = ppt;
    if (!entry && kind === 's') {
      // Shadows: paint them for this sun; meanwhile the ones up stay (an older sun's).
      this.request(kind, ck, ppt, d2 + 1);
      const cur = this.shown.get(sk);
      if (cur) { const e = this.cache.get(cur.key); if (e) e.used = this.frame; }
      return;
    }
    if (!entry) {
      this.request(kind, ck, ppt, d2 + (kind === 'r' ? 0.5 : 0));
      if (ppt !== 8) this.request(kind, ck, 8, d2 - 1000); // a cheap low-res stand-in first
      for (const b of [...BUCKETS].reverse()) {
        const e = this.cache.get(`${kind}:${ck}:${b}`);
        if (e) { entry = e; useKey = `${kind}:${ck}:${b}`; usePpt = b; break; }
      }
    }
    const cur = this.shown.get(sk);
    if (entry) {
      entry.used = this.frame;
      if (!cur || cur.key !== useKey) {
        cur?.sprite.destroy();
        this.shown.delete(sk);
        if (entry.tex) {
          const s = new Sprite(entry.tex);
          s.scale.set(1 / usePpt);
          s.position.set(cx * CHUNK, cy * CHUNK);
          (kind === 'g' ? this.groundLayer : kind === 's' ? this.sunLayer : this.reliefLayer).addChild(s);
          this.shown.set(sk, { sprite: s, key: useKey });
        }
      }
      if (useKey !== key && kind === 'g') this.missing.count++;
    } else if (kind === 'g') {
      this.missing.count++;
      if (!cur) {
        const s = new Sprite(Texture.WHITE);
        s.tint = num(C.sand);
        s.position.set(cx * CHUNK, cy * CHUNK);
        s.width = s.height = CHUNK;
        this.groundLayer.addChild(s);
        this.shown.set(sk, { sprite: s, key: 'placeholder' });
      }
    }
  }

  /**
   * Per frame: choose visible chunks and buckets, place sprites, queue paints. P is the view
   * projection and t its plan-ness (the relief paint only shows in the iso half).
   */
  update(cam: CamState, vw: number, vh: number, dpr: number, P: Lin, t: number): void {
    this.frame++;
    // Texels per tile for ~1 texel per screen px: a tile edge spans ~36 world px in iso, 32 in plan.
    const need = cam.zoom * (36 - 4 * t) * dpr;
    const ppt = BUCKETS.find((b) => b >= need * 0.9) ?? 64;
    const rppt = Math.min(ppt, RELIEF_MAX);
    const [ctx, cty] = apply(invert(P), cam.cx, cam.cy);
    const ccx = ctx / CHUNK, ccy = cty / CHUNK;
    const want = new Set<string>();
    const relief = t < 0.6;
    this.missing.count = 0;
    this.visible = visibleChunksP(P, cam, vw, vh, 0, reliefHead(t, MAX_LEVEL));
    // Drop queued requests that are no longer wanted at this bucket.
    this.queue = this.queue.filter((q) => (q.kind === 's' ? q.sun === this.sunKey : q.ppt === (q.kind === 'g' ? ppt : rppt) || q.ppt === 8));
    for (const [cx, cy] of this.visible) {
      const ck = cy * CHUNKS + cx;
      const d2 = (cx + 0.5 - ccx) ** 2 + (cy + 0.5 - ccy) ** 2;
      want.add(`g:${ck}`);
      this.show('g', ck, cx, cy, ppt, d2);
      if (relief) {
        want.add(`r:${ck}`); this.show('r', ck, cx, cy, rppt, d2);
        want.add(`s:${ck}`); this.show('s', ck, cx, cy, SUN_PPT, d2);
      }
    }
    for (const [sk, s] of this.shown) if (!want.has(sk)) { s.sprite.destroy(); this.shown.delete(sk); }
    this.pump();
  }

  stats(): { chunks: number; vramMB: number; inflight: number; queued: number } {
    let n = 0;
    for (const k of this.shown.keys()) if (k.startsWith('g:')) n++;
    return { chunks: n, vramMB: Math.round(this.bytes / 1048576), inflight: this.inflight.size, queued: this.queue.length };
  }
}
