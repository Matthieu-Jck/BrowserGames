// slots.ts — where a base is kept (plan §9). Saves alternate between slots `a` and `b`, each
// with a sequence number, so a write cut short never takes the last good save with it; the newest
// whole one wins at load. Copies beside them: `prev` (at most every 10 minutes: a recent past to
// fall back to), and one before each risky step — `pre-import`, `pre-migration`, `pre-wipe`. A
// damaged slot is skipped, never overwritten blindly: the next save goes to the other one.
import type { KV } from './kv';
import { intact, seal, type Envelope } from './envelope';
import type { SaveData } from '@/sim/serialize';

export type SlotKey = 'a' | 'b' | 'prev' | 'pre-import' | 'pre-migration' | 'pre-wipe';
export const SLOT_KEYS: readonly SlotKey[] = ['a', 'b', 'prev', 'pre-import', 'pre-migration', 'pre-wipe'];

/** How often `prev` is refreshed. */
export const PREV_EVERY_MS = 10 * 60_000;

export interface SlotInfo { slot: SlotKey; seq: number; savedAt: number; bytes: number; ok: boolean; colonyName: string }

export class SaveSlots {
  /** The slot holding the newest save (the next one goes to the other). */
  private cur: 'a' | 'b' | null = null;
  private seq = 0;
  private prevAt = -Infinity;
  /** The newest envelope written or loaded (export, the settings' « dernière sauvegarde »). */
  last: Envelope | null = null;

  constructor(private readonly kv: KV) {}

  /**
   * The whole saves, newest first: a and b by sequence, then `prev`. Sequence numbers keep
   * growing past every slot seen, damaged ones included.
   */
  async candidates(): Promise<Array<{ env: Envelope; slot: SlotKey }>> {
    const out: Array<{ env: Envelope; slot: SlotKey }> = [];
    for (const slot of ['a', 'b', 'prev'] as const) {
      const e = await this.kv.get<Envelope>(slot);
      if (e && typeof e.seq === 'number') this.seq = Math.max(this.seq, e.seq);
      if (intact(e)) out.push({ env: e, slot });
    }
    const rank = (c: { slot: SlotKey }): number => (c.slot === 'prev' ? 1 : 0);
    return out.sort((x, y) => rank(x) - rank(y) || y.env.seq - x.env.seq);
  }

  /** The save the base was opened from: the next save goes to the other slot. */
  adopt(c: { env: Envelope; slot: SlotKey }): void {
    this.cur = c.slot === 'a' ? 'a' : c.slot === 'b' ? 'b' : null;
    this.last = c.env;
  }

  /** The newest whole save (and the next save goes to the other slot). */
  async loadNewest(): Promise<{ env: Envelope; slot: SlotKey } | null> {
    const best = (await this.candidates())[0] ?? null;
    if (best) this.adopt(best);
    return best;
  }

  /** Write a save to the other slot (and refresh `prev` when it is due). */
  async save(data: SaveData, now: number): Promise<Envelope> {
    const env = await seal(data, { savedAt: now, seq: this.seq + 1 });
    const slot = this.cur === 'a' ? 'b' : 'a';
    await this.kv.put(slot, env);
    this.seq = env.seq;
    this.cur = slot;
    this.last = env;
    if (now - this.prevAt >= PREV_EVERY_MS) { await this.kv.put('prev', env); this.prevAt = now; }
    return env;
  }

  /** Make an imported save the newest (the next boot opens it): written to the other slot, numbered after every save seen. */
  async putNewest(env: Envelope): Promise<Envelope> {
    const e: Envelope = { ...env, seq: this.seq + 1 };
    const slot = this.cur === 'a' ? 'b' : 'a';
    await this.kv.put(slot, e);
    this.seq = e.seq;
    this.cur = slot;
    this.last = e;
    return e;
  }

  /** Keep a copy before a risky step. */
  async backup(slot: 'pre-import' | 'pre-migration' | 'pre-wipe', env: Envelope): Promise<void> {
    await this.kv.put(slot, env);
  }

  /** Forget the base (its copy goes to `pre-wipe` first). The next save starts a new history in a. */
  async wipe(): Promise<void> {
    if (this.last) await this.backup('pre-wipe', this.last);
    for (const k of ['a', 'b', 'prev'] as const) await this.kv.del(k);
    this.cur = null;
    this.last = null;
    this.prevAt = -Infinity;
  }

  async get(slot: SlotKey): Promise<Envelope | null> {
    const e = await this.kv.get<Envelope>(slot);
    return intact(e) ? e : null;
  }

  async list(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (const slot of SLOT_KEYS) {
      const e = await this.kv.get<Envelope>(slot);
      if (!e) continue;
      out.push({ slot, seq: e.seq ?? -1, savedAt: e.savedAt ?? 0, bytes: e.payload?.length ?? 0, ok: intact(e), colonyName: e.colonyName ?? '' });
    }
    return out;
  }
}
