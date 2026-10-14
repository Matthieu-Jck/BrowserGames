// persistence.ts — the shell side of M7 (plan §7, §9; docs/persistence.md). Boot: take the
// one-tab lock (a second tab offers « Reprendre ici »), open the newest whole save (persist/),
// pay the time owed with the offline catch-up behind the boot veil, and keep the report for
// « Jouer ». No save yet: found a base on a land of its own (a random player seed). Then, while
// the base runs:
// - autosave: every 30 s, 2 s after a structural change, and when the tab hides or the page goes
//   away; always the player's own base (a debug base in play is never saved: `realSim()`), one
//   write at a time so the a/b slots alternate cleanly;
// - the world clock: a hidden tab pauses rAF and a slow machine drops ticks (App.tickSim keeps at
//   most 8 per frame), so every few seconds, and when the tab comes back, the time owed is paid
//   with the same catch-up; more than 10 minutes opens « Pendant ton absence ».
// Under automation (navigator.webdriver) the clock is manual — the smoke drives time itself
// (`FL.tick`, `FL.simulateAbsence`, `FL.clock('live')`) — and the saves go to a sandbox database
// (`?sandbox` too), so a test never touches a real base. `?demo` neither saves nor loads.
import { bus } from '@/core/bus';
import { readRaw } from '@/core/store';
import { t } from '@/i18n/i18n';
import { duration } from '@/i18n/format';
import type { AwayReport } from '@/sim/offline/report';
import type { RemapNote } from '@/sim/save-remap';
import { TICK_MS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { MemoryKV, openIdb } from '@/persist/kv';
import { SaveSlots } from '@/persist/slots';
import { tryLock, takeOver, type ColonyLock } from '@/persist/lock';
import { catchUpTo, openSaved, owedTicks, rebuild, saveNow, worldMs } from '@/persist/colony';
import { fromText, seal, toText, unseal, type Envelope } from '@/persist/envelope';
import { serialize } from '@/sim/serialize';
import { showConflict } from '@/ui/screens/conflict';
import { AbsenceScreen } from '@/ui/screens/absence';
import type { App } from './app';
import type { DebugBases } from './debug-bases';

export const AUTOSAVE_MS = 30_000;
/** A structural change is saved this long after the last one (a drag of ribbons is one save). */
export const STRUCTURE_SAVE_MS = 2_000;
/** The clock is checked this often; it pays the time owed beyond `RESYNC_TICKS` (2 s). */
export const RESYNC_EVERY_MS = 5_000;
export const RESYNC_TICKS = 20;
/** Away at least this long: the report opens (10 minutes), else a toast says what was caught up. */
export const REPORT_TICKS = 6_000;
/** When the base was last exported to a file (localStorage): a reminder after 7 days (Safari clears site storage after 7 days without a visit). */
export const EXPORTED_KEY = 'ocelle.exported.v1';
const REMIND_MS = 7 * 24 * 3600_000;

export interface Booted {
  sim: Sim;
  /** null: nothing is saved (?demo). */
  slots: SaveSlots | null;
  lock: ColonyLock | null;
  /** The catch-up of the time away at boot, for « Jouer » (null: none, or a new base). */
  away: AwayReport | null;
  /** What today's content changed in the save (D47). */
  note: RemapNote | null;
  /** A new base, founded at this boot. */
  fresh: boolean;
  /** The world clock follows the wall clock. */
  live: boolean;
  /** Saves live in memory only (storage refused): the player is told. */
  volatile: boolean;
}

/** Did anything happen while away (a report with nothing in it is a toast, not a page)? */
export function eventful(r: AwayReport): boolean {
  const any = (a: Float64Array): boolean => a.some((v) => v !== 0);
  return r.incidents.length > 0 || r.creditsDelta !== 0 || any(r.produced) || any(r.consumed) || any(r.hearthDelta) || any(r.sold) || any(r.bought);
}

/** Let the veil's new line paint first (a timer, not rAF: a hidden tab never runs rAF, and boot must not wait for the tab to show). */
const letPaint = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

/** A player seed of its own for a new base (the shell may use randomness; the sim never does). */
function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! || 1;
}

/**
 * Open the player's base (or found one). `found(seed)` makes a new colony; `status(key)` writes
 * on the boot veil. Throws when saves exist but none opens (a newer build's, damage everywhere):
 * a new base must never be founded over them.
 */
export async function bootColony(q: URLSearchParams, found: (seed: number) => Sim, status: (text: string) => void): Promise<Booted> {
  const automated = navigator.webdriver;
  const live = !automated;
  const seed = q.has('seed') ? Number(q.get('seed')) >>> 0 : automated || q.has('demo') ? 1 : newSeed();
  if (q.has('demo')) return { sim: found(seed), slots: null, lock: null, away: null, note: null, fresh: true, live, volatile: false };

  const name = automated || q.has('sandbox') ? 'ocelle-sandbox' : 'ocelle';
  let lock = await tryLock(`${name}-colony`);
  if (!lock) {
    lock = await new Promise<ColonyLock>((resolve) => {
      const panel = showConflict(() => { void takeOver(`${name}-colony`).then((l) => { panel.remove(); resolve(l); }); });
    });
  }
  let volatile = false;
  const kv = await openIdb(name).catch((e: unknown) => { console.warn('Ocelle: no IndexedDB, the base lives in memory only', e); volatile = true; return new MemoryKV(); });
  const slots = new SaveSlots(kv);
  const opened = await openSaved(slots);
  if (!opened) {
    const sim = found(seed);
    if (live) sim.run(owedTicks(sim, Date.now())); // the founding minute's first seconds: on the wall clock from the start
    return { sim, slots, lock, away: null, note: null, fresh: true, live, volatile };
  }
  let away: AwayReport | null = null;
  if (live && owedTicks(opened.sim, Date.now()) > RESYNC_TICKS) {
    status(t('boot.catchup'));
    await letPaint();
    away = catchUpTo(opened.sim, Date.now());
  }
  return { sim: opened.sim, slots, lock, away, note: opened.note, fresh: false, live, volatile };
}

export class Persistence {
  /** The world clock follows the wall clock (`FL.clock`). */
  live: boolean;
  /** This tab stepped aside (another one took the base over): nothing more is saved. */
  stopped = false;
  /** The last save's envelope (settings, export), or the one the base was opened from. */
  get last(): Envelope | null { return this.slots?.last ?? null; }
  private chain: Promise<unknown> = Promise.resolve();
  private structTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: App,
    readonly slots: SaveSlots | null,
    private readonly lock: ColonyLock | null,
    private readonly bases: DebugBases | null,
    live: boolean,
    readonly volatile: boolean,
  ) {
    this.live = live;
  }

  /** The player's own base, in play or kept aside behind a debug base. */
  realSim(): Sim {
    return this.bases?.realSim() ?? this.app.sim;
  }

  /**
   * Save the player's base now (queued behind a save in progress). Null when nothing is saved —
   * or when the save failed: that is told with a toast, never thrown (an autosave has no caller).
   */
  save(): Promise<Envelope | null> {
    const slots = this.slots;
    if (!slots || this.stopped) return Promise.resolve(null);
    const run = this.chain.then(() => saveNow(slots, this.realSim(), Date.now())).catch((e: unknown) => {
      console.warn('Ocelle: save failed', e);
      this.app.toasts.show('bad', t('toast.saveFailed', { msg: e instanceof Error ? e.message : String(e) }), 6000);
      return null;
    });
    this.chain = run;
    return run;
  }

  /** Pay the time owed now (when the clock is live and the player's base is in play); the report. */
  resync(force = false): AwayReport | null {
    const app = this.app;
    if (this.stopped || (!force && (!this.live || app.paused || document.hidden)) || this.bases?.current()) return null;
    const now = Date.now();
    if (owedTicks(app.sim, now) <= RESYNC_TICKS) return null;
    const report = catchUpTo(app.sim, now);
    if (report) this.show(report);
    return report;
  }

  /** After a catch-up: the views follow, then a toast or the report. */
  show(report: AwayReport): void {
    const app = this.app;
    app.caughtUp(report);
    const ticks = report.toTick - report.fromTick;
    if (ticks < REPORT_TICKS || !eventful(report)) {
      if (ticks >= 600) app.toasts.show('info', t('toast.caughtUp', { d: duration((ticks * TICK_MS) / 1000) }));
      return;
    }
    app.away = report;
    if (!app.screens.current) app.screens.open('absence');
  }

  install(): void {
    this.lock?.onTakeover(() => void this.stepAside());
    if (this.volatile) setTimeout(() => this.app.toasts.show('bad', t('toast.volatile'), 8000), 1500);
    if (!this.slots) return;
    // A base older than a week that has not been exported for a week: say so once per visit.
    const exported = Number(readRaw(EXPORTED_KEY) ?? 0);
    const since = Math.max(exported, this.realSim().foundingEpoch * 60_000);
    if (!navigator.webdriver && Date.now() - since > REMIND_MS) setTimeout(() => this.app.toasts.show('info', t('save.remind'), 9000), 4000);
    setInterval(() => void this.save(), AUTOSAVE_MS);
    setInterval(() => this.resync(), RESYNC_EVERY_MS);
    bus.on('sim:structure', () => {
      if (this.structTimer) clearTimeout(this.structTimer);
      this.structTimer = setTimeout(() => { this.structTimer = null; void this.save(); }, STRUCTURE_SAVE_MS);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.save();
      else this.resync();
    });
    // The page going away: the write is started at once (IndexedDB usually completes it).
    addEventListener('pagehide', () => void this.save());
    document.addEventListener('freeze', () => void this.save());
    // Ask the browser to keep the base when it clears storage under pressure (granted or not).
    void navigator.storage?.persist?.().catch(() => false);
  }

  /** The export file's text of the player's base (saved first); null when nothing is saved. */
  async exportText(): Promise<string | null> {
    const e = await this.save();
    return e ? toText(e) : null;
  }

  /** What an export file holds, for the confirmation (null: not a whole Ocelle save). */
  async peek(text: string): Promise<{ name: string; savedAt: number; buildings: number; heartLevel: number } | null> {
    const env = fromText(text);
    if (!env) return null;
    try {
      const d = await unseal(env);
      return { name: env.colonyName, savedAt: env.savedAt, buildings: Math.floor(d.ents.length / 7), heartLevel: d.hearthLevel };
    } catch {
      return null;
    }
  }

  /**
   * Replace the player's base by an export file's: the base is saved and kept as `pre-import`,
   * the file becomes the newest save, and the page reloads into it (the boot opens it and pays
   * the time since it was written). False when the file is not a whole save or does not open.
   */
  async importText(text: string): Promise<boolean> {
    const slots = this.slots;
    const env = fromText(text);
    if (!slots || !env) return false;
    try { await rebuild(env); } catch (e) { console.warn('Ocelle: the imported save does not open', e); return false; }
    const mine = await this.save();
    if (mine) await slots.backup('pre-import', mine);
    await slots.putNewest(env);
    this.stopped = true;
    location.reload();
    return true;
  }

  /** Give the base back and start a new one: a `pre-wipe` copy is kept, then the page reloads onto new land. */
  async wipe(): Promise<void> {
    const slots = this.slots;
    if (!slots) return;
    await this.save();
    await slots.wipe();
    this.stopped = true;
    location.reload();
  }

  /** Debug: as if the player had been away `hours` (the base fast-forwards by the catch-up, from a fresh save of it). */
  async simulateAbsence(hours: number): Promise<AwayReport | null> {
    if (this.bases?.current()) this.bases.restore();
    const env = await this.save() ?? await seal(serialize(this.app.sim), { savedAt: Date.now(), seq: 0 });
    const { sim } = await rebuild(env);
    const report = catchUpTo(sim, worldMs(sim) + Math.round(hours * 3_600_000));
    this.app.setSim(sim);
    if (report) this.show(report);
    await this.save();
    return report;
  }

  /** Another tab takes the base over: save, let the lock go, freeze this one. */
  private async stepAside(): Promise<void> {
    if (this.stopped) return;
    await this.save();
    this.stopped = true;
    this.app.paused = true;
    this.lock?.release();
    showConflict(() => location.reload(), true);
  }
}

export function installPersistence(app: App, b: Booted, bases: DebugBases | null): Persistence {
  const p = new Persistence(app, b.slots, b.lock, bases, b.live, b.volatile);
  app.persistence = p;
  // The boot's catch-up: a report for « Jouer » when the absence was long, else a toast.
  if (b.away) {
    const ticks = b.away.toTick - b.away.fromTick;
    if (ticks >= REPORT_TICKS && eventful(b.away)) app.away = b.away;
    else if (ticks >= 600) app.toasts.show('info', t('toast.caughtUp', { d: duration((ticks * TICK_MS) / 1000) }));
  }
  app.changes = b.note;
  // « Pendant ton absence »: read once, then gone (closing it is reading it).
  app.screens.register('absence', new AbsenceScreen({
    report: () => app.away,
    changes: () => app.changes,
    sim: () => app.sim,
    close: () => { if (app.screens.current === 'absence') app.screens.open(null); },
    read: () => { app.away = null; app.changes = null; },
  }));
  p.install();
  if (b.fresh) void p.save(); // a new base is kept from its first second
  return p;
}
