// sound.ts — the audio layer's front door, for the shell: owns the one AudioContext of the
// session and the engine on it, and never throws. Browsers keep audio locked until the player
// does something, so the context is created (or resumed) on the first click or key (`unlock`,
// which the shell calls from its gesture listeners — the main menu's « Jouer » in practice).
// Without Web Audio (Node in the tests, an old browser) everything is a no-op; if the engine ever
// fails, sound turns itself off with one warning and the game goes on.
//
// Cues are queued as they come (bus `sfx`, clicks, toasts…) and played once per frame: the batch
// is arbitrated (a specific cue silences the generic clicks and toasts of the same moment) and
// rate-limited (cues.ts). The buildings' signatures (D120) come in their own queue: merged and
// capped (signatures.ts), they answer the moment like a specific cue — a building's signature as
// it stands takes the placement thunk's place, and silences the frame's clicks and toasts. A
// hidden tab fades the master out and suspends the context; showing it again resumes and fades
// back in. The volumes come from the settings every frame (change-only).
import type { SfxCue } from '@/core/bus';
import { arbitrate, RateLimiter, type QueuedCue } from './cues';
import { SoundEngine, type SoundWorld } from './engine';
import { DEFAULT_VOLUMES, sameVolumes, type Volumes } from './levels';
import { mergeSignatures, SigLimiter, SIGNATURES, type QueuedSig, type Signature, type SigVariant } from './signatures';

/** off: no Web Audio here · locked: waiting for a gesture · running · hidden: the tab is hidden · failed: turned off after an error. */
export type SoundState = 'off' | 'locked' | 'running' | 'hidden' | 'failed';

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

function contextClass(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** What the debug handle and the smoke test can see. */
export interface SoundReport {
  state: SoundState;
  /** The AudioContext's own state ('none' before the first gesture). */
  context: string;
  /** Audio clock (s). */
  time: number;
  /** Cues played since the start, and the last few (a signature as `sig.<name>.<variant>`). */
  played: number;
  recent: string[];
  volumes: Volumes;
  /** The score: part of the day, mode, tempo, step, chord. */
  score: ReturnType<SoundEngine['describe']> | null;
}

export class Sound {
  state: SoundState;
  private ctx: AudioContext | null = null;
  private engine: SoundEngine | null = null;
  private readonly queue: QueuedCue[] = [];
  private readonly sigs: QueuedSig[] = [];
  private readonly limiter = new RateLimiter();
  private readonly sigLimiter = new SigLimiter();
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private hidden = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private played = 0;
  private readonly recent: string[] = [];

  /** @param seed seeds the score (the shell passes a per-session value: the music differs every visit). */
  constructor(private readonly seed: number) {
    this.state = contextClass() ? 'locked' : 'off';
  }

  /** Is there Web Audio at all in this browser? */
  get available(): boolean {
    return this.state !== 'off' && this.state !== 'failed';
  }

  /** A user gesture happened: create the context and the engine (first time), or resume it. */
  unlock(): void {
    if (!this.available) return;
    try {
      if (!this.ctx) {
        const AC = contextClass();
        if (!AC) { this.state = 'off'; return; }
        this.ctx = new AC();
        this.engine = new SoundEngine(this.ctx, { seed: this.seed, volumes: this.volumes });
        this.engine.start();
      }
      if (this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume().catch(() => { /* retried on the next gesture */ });
      this.state = this.hidden ? 'hidden' : 'running';
    } catch (e) {
      this.fail(e);
    }
  }

  /** The tab was hidden (fade out, then suspend) or shown again (resume, fade in). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx || !this.engine || !this.available) return;
    try {
      if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      if (hidden) {
        this.state = 'hidden';
        this.queue.length = 0;
        this.sigs.length = 0;
        this.engine.setVisible(false);
        this.suspendTimer = setTimeout(() => { if (this.hidden) this.ctx?.suspend().catch(() => {}); }, 300);
      } else {
        this.state = 'running';
        this.ctx.resume().catch(() => {});
        this.engine.setVisible(true);
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** The sliders (0–1 each); applied when they changed. */
  setVolumes(v: Volumes): void {
    if (sameVolumes(v, this.volumes)) return;
    this.volumes = { ...v };
    if (!this.engine) return;
    try { this.engine.setVolumes(this.volumes); } catch (e) { this.fail(e); }
  }

  /** Queue a cue for this frame (dropped while sound is not running). */
  cue(cue: SfxCue, n = 1): void {
    if (this.state !== 'running') return;
    this.queue.push({ cue, n });
    if (this.queue.length > 64) this.queue.shift();
  }

  /**
   * Queue a building's signature for this frame (D120): `gain` is the spatial fade (0 … 1), `pan`
   * where it stands on screen, `n` how many buildings it stands for.
   */
  signature(s: Signature, variant: SigVariant, gain = 1, pan = 0, n = 1): void {
    if (this.state !== 'running') return;
    this.sigs.push({ sig: s, variant, gain, pan, n });
    if (this.sigs.length > 64) this.sigs.shift();
  }

  /** Once per frame: play the frame's cues, then let the engine follow the world. */
  frame(world: SoundWorld): void {
    // A context that is not running yet (created on a key the browser does not count as a
    // gesture, or still resuming) would hold the cues and play them all at once later: drop them.
    if (this.state !== 'running' || !this.engine || !this.ctx || this.ctx.state !== 'running') { this.queue.length = 0; this.sigs.length = 0; return; }
    try {
      const now = this.ctx.currentTime;
      if (this.sigs.length || this.queue.length) {
        const sigs = this.sigs.length ? this.playable(now) : [];
        // A machine's signature as it stands takes the placement thunk's place (its build has its own set-down).
        const batch = sigs.some((q) => q.variant === 'build' && !SIGNATURES[q.sig].quiet) ? this.queue.filter((q) => q.cue !== 'place') : this.queue;
        for (const q of sigs) {
          this.engine.playSignature(q.sig, q.variant, q.gain, q.pan, now + 0.005);
          this.note(`sig.${q.sig}.${q.variant}`);
        }
        for (const q of arbitrate(batch, sigs.length > 0)) {
          if (!this.limiter.allow(q.cue, now)) continue;
          this.engine.play(q.cue, q.n, now + 0.005);
          this.note(q.cue);
        }
        this.queue.length = 0;
        this.sigs.length = 0;
      }
      this.engine.update(world, now);
    } catch (e) {
      this.fail(e);
    }
  }

  /**
   * The frame's signatures that may play: merged and capped, a line piece's build dropped when a
   * ribbon drag ticks in the same frame (its ticks are that sound), then spaced.
   */
  private playable(now: number): QueuedSig[] {
    const drag = this.queue.some((q) => q.cue === 'ribbon');
    return mergeSignatures(this.sigs)
      .filter((q) => !(drag && q.variant === 'build' && SIGNATURES[q.sig].quiet))
      .filter((q) => this.sigLimiter.allow(q.sig, q.variant, now));
  }

  private note(what: string): void {
    this.played++;
    this.recent.push(what);
    if (this.recent.length > 8) this.recent.shift();
  }

  describe(): SoundReport {
    return {
      state: this.state, context: this.ctx?.state ?? 'none', time: this.ctx?.currentTime ?? 0,
      played: this.played, recent: [...this.recent], volumes: { ...this.volumes },
      score: this.engine?.describe() ?? null,
    };
  }

  private fail(e: unknown): void {
    this.state = 'failed';
    this.queue.length = 0;
    this.sigs.length = 0;
    console.warn('Ocelle: sound turned off after an error', e);
    try { void this.ctx?.close().catch(() => {}); } catch { /* nothing more to do */ }
    this.ctx = null;
    this.engine = null;
  }
}
