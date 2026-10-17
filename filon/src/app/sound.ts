// sound.ts (shell) — what the base sounds like, wired. src/audio makes the sound; this file tells
// it what is going on, and is the only place that does (the audio layer reads nothing itself):
//
// - unlock: browsers keep audio locked until a gesture, so the first pointer press or key anywhere
//   creates the AudioContext (the main menu's « Jouer » in practice); later gestures resume it.
// - the tab hidden → sound fades out and the context is suspended; shown → it comes back.
// - each frame: the volumes from the settings, the world clock and night factor of the day/night
//   look (FL.dayPhase moves the music too), the weather's gust level, the camera's zoom and the
//   items drawn on ribbons in view; four times a second a scan of the flow graph counts the
//   machines running (the music's pulses) and those in view, weighted towards the centre and
//   panned (the machine bed).
// - cues: bus `sfx` (build tools, power wires, sim events — see build-mode.ts and sim-events.ts),
//   screens opening and closing, the view morphing, clicks on buttons (tabs and segmented options
//   sound as tabs), toasts by kind (watched on the toast stack), and spot trades at the Crier (new
//   `spot` commands in the colony's log).
// - the buildings' signatures (D120): read off the same log, a `place` command plays its
//   building's signature as it stands — at once on the claim; off it, when its kite lands, and
//   only near the camera (the sites are watched until then). A building selected plays its
//   signature's softer variant. Both fade with the distance to the screen's centre.
import { activityOf } from '@/audio/director';
import type { SoundWorld } from '@/audio/engine';
import { SIG_OF_DEF, spatialGain, spatialPan, type SigVariant } from '@/audio/signatures';
import { Sound, type SoundReport } from '@/audio/sound';
import { bus, type SfxCue } from '@/core/bus';
import type { NotifyKind } from '@/core/kinds';
import { apply } from '@/render/projection';
import { EPOCH } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import { gustPermille } from '@/sim/power/network';
import type { Sim } from '@/sim/state';
import { St, type Ent } from '@/sim/types';
import { settings } from '../settings';
import type { App } from './app';

export interface SoundShell {
  readonly sound: Sound;
  /** Once per frame, after `App.frame`. */
  frame(dt: number): void;
  /** For the debug handle and the smoke test: `FL.app.sound.describe()`. */
  describe(): SoundReport;
}

/** Buttons that switch between views of the same thing sound as tabs. */
const TABS = '.bb-tab, .cr-tab, .set-opt, [role="tab"]';
const TOAST: Record<NotifyKind, SfxCue> = { info: 'toast.info', good: 'toast.good', warn: 'toast.warn', bad: 'toast.bad' };

/** Install the sound on the app (sets `app.sound`). `seed`: a per-session value, so each visit hears new music. */
export function installSound(app: App, seed: number): SoundShell {
  const sound = new Sound(seed >>> 0);
  const world: SoundWorld = { hour: 12, night: 0, gust: 1000, activity: 0, machines: 0, machinePan: 0, items: 0, zoom: 1, veiled: false };

  const unlock = (): void => sound.unlock();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));
  sound.setHidden(document.hidden);

  bus.on('sfx', (e) => sound.cue(e.cue, e.n ?? 1));
  bus.on('screen:opened', () => sound.cue('open'));
  bus.on('screen:closed', () => sound.cue('close'));
  bus.on('view:changed', () => sound.cue('view'));
  bus.on('selection:changed', (e) => {
    // A building plays its signature, softly; a site (not standing yet) the plain glint.
    const b = e.entity ? app.sim.ents.get(e.entity) : undefined;
    if (b && b.builtAt === 0) signature(b, 'pick', 0.35);
    else if (e.entity) sound.cue('select');
  });
  // The intro's beats (D31) borrow existing cues: a soft page turn per panel, the lift's whoosh
  // as the Heart starts down, a thud for the « Accordé » stamp and at touchdown.
  bus.on('intro:panel', (e) => sound.cue(e.panel === 'landing' ? 'lift' : 'view'));
  bus.on('intro:stamp', () => sound.cue('place'));
  bus.on('intro:land', () => sound.cue('place'));
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button, [role="button"], [role="tab"]') : null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    sound.cue(b.matches(TABS) ? 'tab' : 'click');
  }, true);
  const toasts = (records: MutationRecord[]): void => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        const kind = n instanceof HTMLElement && n.classList.contains('toast') ? (n.dataset.kind as NotifyKind | undefined) : undefined;
        if (kind && TOAST[kind]) sound.cue(TOAST[kind]);
      }
    }
  };
  const toastWatch = new MutationObserver(toasts);
  toastWatch.observe(app.toasts.root, { childList: true });

  /** A building's signature (D120), faded by its distance to the screen's centre (`floor`: the least gain). */
  function signature(e: Ent, variant: SigVariant, floor: number): void {
    const s = SIG_OF_DEF[e.def];
    if (!s) return;
    const cam = app.camera.cur;
    const [w, h] = footprint(e.def, e.rot);
    const [px, py] = apply(app.view.P, e.x + w / 2 - cam.tx, e.y + h / 2 - cam.ty);
    const u = px / Math.max(1, app.stage.width / 2 / cam.zoom), v = py / Math.max(1, app.stage.height / 2 / cam.zoom);
    sound.signature(s, variant, spatialGain(u, v, cam.zoom, floor), spatialPan(u));
  }

  // Spot trades and placements are commands sent straight to the colony: read them off its log.
  // A placement on the claim stands at once (its signature now); off it a kite flies the
  // materials out, and the site is watched until it stands (`sites`: id → def).
  let sim: Sim = app.sim;
  let seen = sim.log.length;
  const sites = new Map<number, number>();
  const fromLog = (): void => {
    if (app.sim !== sim || sim.log.length < seen) { sim = app.sim; seen = sim.log.length; sites.clear(); }
    for (; seen < sim.log.length; seen++) {
      const c = sim.log[seen]!.cmd;
      if (c.k === 'spot') sound.cue(c.side === 'sell' ? 'sale' : 'purchase');
      else if (c.k === 'place') {
        const e = sim.entityAt(c.x, c.y);
        if (e && e.builtAt === 0) signature(e, 'build', 0.35);
        else if (e) sites.set(e.id, e.def);
      }
    }
    for (const [id, def] of sites) {
      const e = sim.ents.get(id);
      if (!e || e.def !== def) sites.delete(id);
      else if (e.builtAt === 0) { sites.delete(id); signature(e, 'build', 0); }
    }
  };

  /** The machines: running in the whole base (activity), and in view (weighted to the centre, with a pan). */
  const machines = (): void => {
    const s = app.sim, nodes = s.graph?.nodes;
    let running = 0, inView = 0, pan = 0;
    if (nodes && !app.paused) {
      const cam = app.camera.cur;
      const [x0, y0, x1, y1] = app.view.visibleTiles(app.camera.state, app.stage.width, app.stage.height);
      const half = Math.max(1, app.stage.width / 2 / cam.zoom); // half the screen, in world px
      for (const n of nodes) {
        if ((n.kind !== 'machine' && n.kind !== 'drill' && n.kind !== 'generator') || (n.status !== St.Ok && n.status !== St.LowPower)) continue;
        const e = s.ents.get(n.ent);
        if (!e || e.builtAt !== 0 || s.isDormant(e)) continue; // a site or a dormant building makes no noise
        running++;
        if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
        const u = Math.max(-1, Math.min(1, apply(app.view.P, e.x + 0.5 - cam.tx, e.y + 0.5 - cam.ty)[0] / half));
        const w = 1 - 0.6 * Math.abs(u);
        inView += w;
        pan += u * w;
      }
    }
    world.activity = activityOf(running);
    world.machines = inView;
    world.machinePan = inView > 0 ? pan / inView : 0;
  };

  let scan = 1;
  const shell: SoundShell = {
    sound,
    frame(dt) {
      sound.setVolumes({ master: settings.volMaster, music: settings.volMusic, sfx: settings.volSfx });
      // Silent (locked, hidden): what happens meanwhile is not played later in a burst.
      if (sound.state !== 'running') { sim = app.sim; seen = sim.log.length; sites.clear(); sound.frame(world); return; }
      fromLog();
      scan += dt;
      if (scan >= 0.25) { scan = 0; machines(); }
      // Toasts shown during this frame's events (a quest done…) join this frame's batch, so the
      // specific cue that came with them silences their generic one.
      toasts(toastWatch.takeRecords());
      const g = app.dayNight.grade;
      world.hour = g.hour;
      world.night = g.night;
      world.gust = gustPermille(Math.floor(app.dayNight.worldTick(app.sim) / EPOCH), app.sim.worldSeed, app.sim.mods.gustVariance);
      world.zoom = app.camera.cur.zoom;
      world.items = app.items.count;
      world.veiled = !!app.screens.current;
      sound.frame(world);
    },
    describe: () => sound.describe(),
  };
  app.sound = shell;
  return shell;
}
