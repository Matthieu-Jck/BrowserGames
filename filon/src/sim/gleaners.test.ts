// gleaners.test.ts — the Gleaners (D103): where they reach (the cirque never, rock and water never,
// a fence closes a pocket in), when (the dark hours only), what (shiny, made things; never ore),
// how much (a share of what passes on an exposed line), the protections (glass, fences), the night's
// tally and the morning report, saves, replay, and online ≈ offline over several nights.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { BAL } from '@/content/balance';
import { FlatSource } from './world/grid';
import { Sim } from './state';
import { T, type Rot } from './types';
import { CENTER, EPOCH, WORLD, WORLD_EPOCH0 } from './constants';
import { line, learnPlans, stockedSilo } from './testkit';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { replay } from './commands';
import { gleanNight } from './systems/gleaners';
import { GLEAN_WINDOW, RAID_ARRIVE, RAID_TICKS, raidBandFor, raidBandOf, raidCalled, raidSize } from './flow/chain';

/**
 * A desert land with a Crown: a square ring of rock (level 1) round the centre, |dx| or |dy| from
 * 11 to 14, and its foot at r 15 (`crownOuter`): sand everywhere else. Extra rock rectangles
 * (`rocks`) make mountains in the desert.
 */
class DesertSource extends FlatSource {
  readonly crownOuter = 15;
  constructor(rocks: ReadonlyArray<{ x: number; y: number; w: number; h: number; t: number }> = []) {
    const c = CENTER;
    super([], [
      { x: c - 14, y: c - 14, w: 29, h: 4, t: T.Rock1 }, { x: c - 14, y: c + 11, w: 29, h: 4, t: T.Rock1 },
      { x: c - 14, y: c - 14, w: 4, h: 29, t: T.Rock1 }, { x: c + 11, y: c - 14, w: 4, h: 29, t: T.Rock1 },
      ...rocks,
    ]);
  }
}

/** Day epoch 0 of world day 1: the night's first minute. */
const NIGHT = WORLD_EPOCH0 + 36;
/** Noon of world day 1. */
const NOON = WORLD_EPOCH0 + 36 + 24;

function desertSim(foundingEpoch = NIGHT, rocks?: ConstructorParameters<typeof DesertSource>[0], source?: FlatSource): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: source ?? new DesertSource(rocks), foundingEpoch });
  learnPlans(sim);
  sim.done.add('xp_guard'); // the fence and the glazed ribbon (a research): granted outside the commands, as steadyPower's
  sim.rebuildDerived();
  return sim;
}

/**
 * A line out in the desert east of the Crown: a silo of `n` `item` at (530, 520) hands north onto
 * a 20-tile ribbon (x 530, y 519 → 500) into a silo at (530, 498). Returns the two silos.
 */
function desertLine(sim: Sim, item = 'glass', n = 4000, ribbon = 'ribbon'): { from: number; to: number } {
  const from = stockedSilo(sim, 530, 520, 0, item, n);
  const laid = sim.placeBelts(ribbon, line(530, 519, 0, 20));
  if (laid !== 20) throw new Error(`ribbons ${laid}`);
  const to = sim.place('silo', 530, 498, 0);
  if (!to.ok) throw new Error(`silo ${to.reason}`);
  return { from, to: to.id! };
}

const ti = (x: number, y: number): number => y * WORLD + x;
const held = (s: Sim, id: number, item: string): number => s.stores.get(id)![itemIdx(item)]! / 1000;
const takenOf = (s: Sim, item: string): number => s.gleaned[itemIdx(item)]! / 1000;

/** A rectangle's border of fences, x0…x1 × y0…y1 inclusive; `gap`: one tile left open. */
function fenceBox(sim: Sim, x0: number, y0: number, x1: number, y1: number, gap?: [number, number]): void {
  for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (!gap || gap[0] !== x || gap[1] !== y) sim.place('fence', x, y, 0);
  for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) if (!gap || gap[0] !== x || gap[1] !== y) sim.place('fence', x, y, 0);
}

describe('the Gleaners (D103)', () => {
  it('reach the ribbons beside open desert floor, never in the cirque, nor behind rock or a fence', () => {
    // A pocket of sand closed in by rock out in the desert, east of the line: x 540…548, y 500…508.
    const sim = desertSim(NIGHT, [
      { x: 540, y: 500, w: 9, h: 1, t: T.Rock1 }, { x: 540, y: 508, w: 9, h: 1, t: T.Rock1 },
      { x: 540, y: 500, w: 1, h: 9, t: T.Rock1 }, { x: 548, y: 500, w: 1, h: 9, t: T.Rock1 },
    ]);
    desertLine(sim);
    // In the cirque: a ribbon by the Core, floor all round it.
    expect(sim.placeBelts('ribbon', line(505, 512, 0, 3))).toBe(3);
    // In the rock pocket (the Crown's land is held: off it a ribbon is remote, still allowed).
    expect(sim.placeBelts('ribbon', line(544, 506, 0, 3))).toBe(3);
    sim.ensureCompiled();
    const ex = new Set(sim.graph.glean.exposed);
    for (let y = 500; y <= 519; y++) expect(ex.has(ti(530, y)), `desert ribbon ${y}`).toBe(true);
    for (let y = 510; y <= 512; y++) expect(ex.has(ti(505, y)), 'cirque').toBe(false);
    for (let y = 504; y <= 506; y++) {
      expect(ex.has(ti(544, y)), 'rock pocket').toBe(false);
      expect(sim.graph.glean.guarded).toContain(ti(544, y));
    }
    // The line's chain knows its exposed cells and its raid: a group of five (20 exposed tiles), on a run of them.
    const c = sim.chainAt(530, 510)!;
    expect(c.gleanCells.length).toBe(20);
    expect(c.raidPosts.length).toBe(raidSize(20));
    expect(raidSize(20)).toBe(BAL.gleaners.group.max);
    for (let p = 1; p < c.raidPosts.length; p++) expect(c.raidPosts[p]! - c.raidPosts[p - 1]!).toBe(1);
    expect(c.raidAt + RAID_TICKS).toBeLessThanOrEqual(GLEAN_WINDOW);
    // A short dash across a corner: fewer of them (one a tile).
    expect([raidSize(1), raidSize(2), raidSize(3), raidSize(11), raidSize(40)]).toEqual([1, 2, 3, 4, 5]);
    // A world with no Crown (the tests' flat world): no Gleaners.
    const flat = desertSim(NIGHT, [], new FlatSource());
    desertLine(flat);
    flat.ensureCompiled();
    expect(flat.graph.glean.exposed.length).toBe(0);
  });

  it('a fence closes an outpost in; one fence gone, the desert is in again', () => {
    const sim = desertSim();
    desertLine(sim);
    fenceBox(sim, 527, 494, 534, 524);
    sim.ensureCompiled();
    expect(sim.graph.glean.exposed.length).toBe(0);
    expect(sim.graph.glean.guarded).toContain(ti(530, 510));
    // Outside the east side of the box, open desert: where they prowl; never inside it.
    expect(sim.graph.glean.prowl).toContain(ti(535, 510));
    expect(sim.graph.glean.prowl).not.toContain(ti(533, 510));
    sim.run(EPOCH * 6);
    expect(takenOf(sim, 'glass')).toBe(0);
    // A gap in the fence: the pocket opens onto the desert.
    expect(sim.remove(534, 510)).toBe(true); // east: the open desert (west is the Crown's rock)
    sim.ensureCompiled();
    expect(sim.graph.glean.exposed).toContain(ti(530, 510));
    sim.run(EPOCH * 4);
    expect(takenOf(sim, 'glass')).toBeGreaterThan(0);
  });

  it('take a share of what passes, at night only, by their taste; nothing vanishes uncounted', () => {
    const sim = desertSim();
    const { from, to } = desertLine(sim);
    const glass = itemIdx('glass');
    const total0 = sim.totalHeld(glass);
    sim.run(EPOCH * 12); // the whole night: three raids, a band of two for glass, one item each
    const taken = takenOf(sim, 'glass');
    const arrived = held(sim, to, 'glass');
    expect(taken).toBeGreaterThanOrEqual(4);
    expect(taken).toBeLessThanOrEqual(8);
    expect(taken / (taken + arrived)).toBeLessThan(0.02);
    // Conservation: what is held anywhere is what was there, less what they took.
    expect(sim.totalHeld(glass)).toBe(total0 - sim.gleaned[glass]!);
    expect(held(sim, from, 'glass')).toBeGreaterThan(0);
    // Day: nothing more.
    const before = takenOf(sim, 'glass');
    sim.run(EPOCH * 20);
    expect(gleanNight(sim.absEpoch())).toBe(false);
    expect(takenOf(sim, 'glass')).toBe(before);
    // Iron ore they leave.
    const ore = desertSim();
    desertLine(ore, 'iron_ore');
    ore.run(EPOCH * 6);
    expect(takenOf(ore, 'iron_ore')).toBe(0);
    expect(held(ore, ore.ents.sorted().find((e) => e.x === 530 && e.y === 498)!.id, 'iron_ore')).toBeGreaterThan(100);
  });

  it('a raid: the group at its posts, each taking the first thing that comes up to it, one apiece, then gone', () => {
    const sim = desertSim();
    desertLine(sim);
    sim.ensureCompiled();
    const c = sim.chainAt(530, 510)!;
    const posts = Array.from(c.raidPosts, (i) => c.tiles[i]!);
    let seen = 0;
    const perRaid = new Map<number, Set<number>>(); // raid (window index) → posts that took
    for (let k = 0; k < 48; k++) {
      sim.run(EPOCH / 4);
      const r = sim.gleaners.recent;
      for (let i = 0; i + 2 < r.length; i += 3) {
        const tile = r[i]!, tick = r[i + 2]!, w = Math.floor(tick / GLEAN_WINDOW), at = tick % GLEAN_WINDOW;
        const p = posts.indexOf(tile);
        expect(p, `theft on ${tile}: one of the posts`).toBeGreaterThanOrEqual(0);
        expect(at - c.raidAt, 'in the raid, the band arrived and its post open').toBeGreaterThanOrEqual(RAID_ARRIVE + p * BAL.gleaners.stagger);
        expect(at - c.raidAt).toBeLessThan(RAID_TICKS);
        expect(p, 'one of the band called').toBeLessThan(raidBandFor(410));
        const took = perRaid.get(w) ?? new Set<number>();
        expect(took.has(p), `post ${p} took twice in raid ${w}`).toBe(false);
        took.add(p);
        perRaid.set(w, took);
        seen++;
      }
      r.length = 0;
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    // Between raids nobody stands at the posts.
    expect(perRaid.size).toBeGreaterThanOrEqual(2);
  });

  it('every take is foreseen: the token on the post\'s cell before the step, the one the views reach for (D112)', () => {
    const sim = desertSim();
    desertLine(sim);
    sim.ensureCompiled();
    const c = sim.chainAt(530, 510)!;
    // The head is never a post (its item may leave on that very step).
    expect(Array.from(c.raidPosts).includes(c.length - 1)).toBe(false);
    let takes = 0;
    for (let k = 0; k < EPOCH * 8; k++) {
      const now = sim.tick, night = sim.gleanNight(now);
      const will = new Map<number, number>(); // post tile → the item it will take
      for (let p = 0; p < c.raidPosts.length; p++) {
        const item = c.raidWillTake(p, now, night);
        if (item < 0) continue;
        expect(c.cells[c.raidPosts[p]!], 'the token is on the post\'s cell').toBe(item + 1);
        will.set(c.tiles[c.raidPosts[p]!]!, item);
      }
      sim.gleaners.recent.length = 0;
      sim.step();
      const r = sim.gleaners.recent, got = new Map<number, number>();
      for (let i = 0; i + 2 < r.length; i += 3) { expect(r[i + 2]).toBe(now); got.set(r[i]!, r[i + 1]!); }
      expect(got, `tick ${now}: the takes foreseen`).toEqual(will);
      // The token taken is off the line: the post's cell no longer holds it as the step leaves it.
      for (const tile of got.keys()) expect(c.moved[c.tiles.indexOf(tile)] === now ? 'refilled' : c.cells[c.tiles.indexOf(tile)]).not.toBe(got.get(tile)! + 1);
      takes += got.size;
    }
    expect(takes).toBeGreaterThanOrEqual(3);
  });

  it('a raid goes only to a line carrying something for them, a bigger band for shinier things (D112)', () => {
    // At each raid's slot: what the line had called (band size), over a night.
    const night = (item: string | null): { bands: number[]; taken: number } => {
      const sim = desertSim();
      desertLine(sim, item ?? 'glass', item ? 4000 : 0);
      sim.ensureCompiled();
      const c = sim.chainAt(530, 510)!, bands: number[] = [];
      let was = false;
      for (let t = 0; t < EPOCH * 12; t++) {
        sim.step();
        const on = raidCalled(c.raidHeld);
        if (on && !was) bands.push(raidBandOf(c.raidHeld));
        was = on;
      }
      return { bands, taken: Array.from(sim.gleaned).reduce((a, b) => a + b, 0) / 1000 };
    };
    // An empty line: called at each slot, but nobody comes, nothing is taken.
    const empty = night(null);
    expect(empty.bands.length).toBeGreaterThanOrEqual(2);
    expect(empty.bands.every((n) => n === 0)).toBe(true);
    expect(empty.taken).toBe(0);
    // A line of iron ore (not to their taste): the same.
    const ore = night('iron_ore');
    expect(ore.bands.every((n) => n === 0)).toBe(true);
    expect(ore.taken).toBe(0);
    // Glass (4.1 ◉): two come; circuits (17 ◉): four.
    const glass = night('glass'), circuit = night('circuit');
    expect(glass.bands.length).toBeGreaterThanOrEqual(2);
    expect(glass.bands.every((n) => n === 2)).toBe(true);
    expect(circuit.bands.every((n) => n === 4)).toBe(true);
    expect(circuit.taken).toBeGreaterThan(glass.taken);
    expect([raidBandFor(0), raidBandFor(170), raidBandFor(410), raidBandFor(600), raidBandFor(1700), raidBandFor(4700)]).toEqual([0, 2, 2, 3, 4, 5]);
  });

  it('a band takes within seconds of arriving and is gone within its short raid (D112)', () => {
    const sim = desertSim();
    desertLine(sim, 'circuit', 4000);
    sim.ensureCompiled();
    const c = sim.chainAt(530, 510)!;
    const firsts: number[] = [];
    let raids = 0;
    for (let t = 0; t < EPOCH * 12; t++) {
      const now = sim.tick, k = (((now % GLEAN_WINDOW) + GLEAN_WINDOW) % GLEAN_WINDOW) - c.raidAt;
      sim.gleaners.recent.length = 0;
      sim.step();
      const r = sim.gleaners.recent;
      for (let i = 0; i + 2 < r.length; i += 3) {
        // Every take inside the raid's short window: after the band has crawled in, before its end.
        expect(k, `take at ${now}`).toBeGreaterThanOrEqual(RAID_ARRIVE);
        expect(k).toBeLessThan(RAID_TICKS);
        if (!firsts.length || firsts.length === raids) firsts.push(k - RAID_ARRIVE);
      }
      // A new raid starts its count at its call.
      if (k === 0) raids = firsts.length;
      // Out of its raid (from the line's first step after its end), nothing is held: the band is gone.
      if (k >= RAID_TICKS + c.stepTicks || k < 0) expect(c.raidHeld, `held at ${k} into the window's slot`).toBe(0);
    }
    expect(firsts.length).toBeGreaterThanOrEqual(2);
    // Arrived, the first take comes within four seconds (a full line of circuits riding past).
    for (const f of firsts) expect(f).toBeLessThanOrEqual(40);
    // The longest a band stays at the line: its take window, twelve seconds.
    expect(RAID_TICKS - RAID_ARRIVE).toBeLessThanOrEqual(200);
  });

  it('a glazed ribbon keeps what it carries', () => {
    const sim = desertSim();
    const { to } = desertLine(sim, 'copper_wire', 4000, 'glazed_ribbon');
    sim.ensureCompiled();
    expect(sim.graph.glean.exposed.length).toBe(0);
    expect(sim.graph.glean.guarded).toContain(ti(530, 510));
    expect(sim.graph.glean.glass).toContain(ti(530, 510)); // they would reach it but for the glass: one may come and tap it
    sim.run(EPOCH * 6);
    expect(takenOf(sim, 'copper_wire')).toBe(0);
    expect(held(sim, to, 'copper_wire')).toBeGreaterThan(300);
    // Dragging the glazed ribbon over a plain one covers it (the same replace group).
    const plain = desertSim();
    desertLine(plain);
    expect(plain.placeBelts('glazed_ribbon', line(530, 519, 0, 20))).toBe(20);
    plain.ensureCompiled();
    expect(plain.graph.glean.exposed.length).toBe(0);
  });

  it('fences are dragged like ribbons, one on each free tile', () => {
    const sim = desertSim(NOON);
    const path: Array<[number, number, Rot]> = line(540, 500, 2, 6);
    expect(sim.placeBelts('fence', path)).toBe(6);
    // Again over the same tiles (another way): all kept.
    expect(sim.planBelts('fence', line(540, 505, 0, 6)).every((s) => s.skip)).toBe(true);
  });

  it('the night is counted at dusk and reported at dawn', () => {
    const sim = desertSim(NOON);
    desertLine(sim);
    const events: Array<{ what: string; taken: Array<[number, number]> }> = [];
    const drain = (): void => { for (const e of sim.events.splice(0)) if (e.k === 'gleaners') events.push(e); };
    sim.run(EPOCH * 12); // to nightfall (day epoch 36 ≡ 0)
    drain();
    expect(gleanNight(sim.absEpoch())).toBe(true);
    expect(sim.gleaners.dusk).not.toBeNull();
    sim.run(EPOCH * 12); // the night
    drain();
    expect(gleanNight(sim.absEpoch())).toBe(false);
    const night = events.find((e) => e.what === 'night'), dawn = events.find((e) => e.what === 'dawn');
    expect(night).toBeDefined();
    expect(dawn).toBeDefined();
    const glass = itemIdx('glass');
    expect(dawn!.taken).toEqual([[glass, sim.gleaned[glass]]]);
    // The line is marked where they took it, through the day.
    const marked = [...sim.gleaners.marks.values()].reduce((a, b) => a + b, 0);
    expect(marked).toBe(sim.gleaned[glass]);
    // A second night: the report counts only that night.
    const first = sim.gleaned[glass]!;
    sim.run(EPOCH * 36);
    drain();
    const dawns = events.filter((e) => e.what === 'dawn');
    expect(dawns.length).toBe(2);
    expect(dawns[1]!.taken[0]![1]).toBe(sim.gleaned[glass]! - first);
    // Through the day the last night's tally holds (the Logistique card's « La nuit dernière »), not the lifetime count.
    expect(sim.gleanedTonight()).toEqual(dawns[1]!.taken);
  });

  it('saves its counts and its night, and the colony goes on alike', () => {
    const sim = desertSim();
    desertLine(sim);
    sim.run(EPOCH * 3);
    const loaded = deserialize(serialize(sim), new DesertSource());
    expect(loaded.hash()).toBe(sim.hash());
    expect(Array.from(loaded.gleaned)).toEqual(Array.from(sim.gleaned));
    expect([...loaded.gleaners.marks]).toEqual([...sim.gleaners.marks].sort((a, b) => a[0] - b[0]));
    sim.run(EPOCH * 3); loaded.run(EPOCH * 3);
    expect(loaded.hash()).toBe(sim.hash());
    expect(Array.from(loaded.gleaned)).toEqual(Array.from(sim.gleaned));
  });

  it('replays: the same commands at night, the same losses', () => {
    // Two colonies set up alike (the silo stocked outside the commands, as in every test here), then
    // the player's commands of the night — a fence drag, a glazed cover — replayed onto the second.
    const setup = (): Sim => { const s = desertSim(); desertLine(s); s.run(EPOCH); return s; };
    const sim = setup(), again = setup();
    const from = sim.log.length;
    sim.placeBelts('fence', line(527, 494, 2, 10));
    sim.run(EPOCH);
    sim.placeBelts('glazed_ribbon', line(530, 509, 0, 5));
    sim.run(EPOCH * 2);
    replay(again, sim.log.slice(from), sim.tick);
    expect(again.hash()).toBe(sim.hash());
    expect(Array.from(again.gleaned)).toEqual(Array.from(sim.gleaned));
    expect(sim.gleaned[itemIdx('glass')]).toBeGreaterThan(0);
  });

  it('online ≈ offline over two nights: the same takings, stocks and state', () => {
    const build = (): Sim => { const s = desertSim(NOON); desertLine(s, 'glass', 6000); s.run(300); return s; };
    const on = build(), off = build();
    const N = EPOCH * 36 * 2;
    on.run(N);
    const rep = catchUp(off, N, { noDirect: true });
    const glass = itemIdx('glass');
    expect(off.tick).toBe(on.tick);
    expect(on.gleaned[glass]).toBeGreaterThanOrEqual(8_000);
    expect(off.gleaned[glass]).toBe(on.gleaned[glass]);
    expect(rep.gleaned[glass]).toBe(on.gleaned[glass]);
    expect(Array.from(off.stock)).toEqual(Array.from(on.stock));
    for (const [id, st] of on.stores) expect(Array.from(off.stores.get(id)!), `store ${id}`).toEqual(Array.from(st));
    expect(off.hash()).toBe(on.hash());
    // The morning reports, the same.
    const dawns = (s: Sim): unknown[] => s.events.filter((e) => e.k === 'gleaners' && e.what === 'dawn').map((e) => (e as { taken: unknown }).taken);
    expect(dawns(off)).toEqual(dawns(on));
  });
});
