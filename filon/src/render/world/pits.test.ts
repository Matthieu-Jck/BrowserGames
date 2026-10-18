// pits.test.ts — the incinerator's pit in the world (D51; owner, 2026-10-14: "a hole in the ground
// with a flame that activates when an item falls in it"): an item a ribbon hands to it rides up the
// chute, tips over the lip and is gone into the dark before its glide ends (so a full line's next
// item never overwrites it mid-fall); the fire flares once for every item that falls in, driven by
// the real engine at 60 frames a second, and dies down when nothing comes; nothing in it jumps.
// D125 (« l'incinérateur doit avoir une petite animation quand il brûle quelque chose »): a burst
// for every item burnt — a ribbon's when it has fallen in, a routing block's a tick after the engine
// took it (from the `SinkNode`'s record), never from a record ahead of the sim (a catch-up's warm-up);
// a fast feed burns steadily instead of strobing; the burst's geometry is stable and bounded.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { line, stockedSilo, testSim } from '@/sim/testkit';
import { opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import type { Sim } from '@/sim/state';
import { CellFlow } from './cell-flow';
import { buildPieces } from './item-flow';
import { SinkNode } from '@/sim/flow/nodes';
import { PIT_WAY, PitFire, flameLevel, heatAt, pitPath, steadyHeat } from './pits';
import { BURST, BURST_LIFE, brighten, burstGlow, burstSeed, burstTints, hash01, puffAt, sparkAt, towards, type PuffAt, type SparkAt } from './pit-burst';

/** The views' rule for a ribbon tile (buildings-view's beltPiece, which pulls in Pixi). */
function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  if (!fed || fed & (1 << opposite(r))) return { corner: false, rot: r };
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  return sides.length === 1 ? { corner: true, rot: opposite(sides[0]!) } : { corner: false, rot: r };
}

describe('the way into a pit', () => {
  it('flat on the ribbon, up the chute, then a fall faster and faster, gone before the glide ends', () => {
    const o = { z: 0, d: 0 };
    expect(pitPath(0.3, o)).toEqual({ z: 0, d: 0 });
    expect(pitPath(0.6, o).z).toBeGreaterThan(0); // on the chute, over the collar
    expect(pitPath(PIT_WAY.tip - 0.001, o).d).toBe(0);
    let z = Infinity, dz = 0;
    for (let f = PIT_WAY.tip + 0.01; f <= PIT_WAY.gone; f += 0.01) {
      const p = pitPath(f, o);
      expect(p.d).toBeGreaterThan(0);
      expect(p.z).toBeLessThan(z);
      expect(z - p.z).toBeGreaterThanOrEqual(dz - 1e-9); // accelerating
      if (z !== Infinity) dz = z - p.z;
      z = p.z;
    }
    expect(pitPath(PIT_WAY.gone, o).d).toBe(1);
    // A full basic line hands the next item on a tick before the glide's end (it is drawn a tick behind): gone by then.
    expect(PIT_WAY.gone).toBeLessThanOrEqual(0.9);
  });

  it('the flame: up fast, down, embers, then nothing', () => {
    expect(heatAt(-1)).toBe(0);
    expect(heatAt(0)).toBeGreaterThan(0.3);
    expect(heatAt(1.5)).toBeCloseTo(1, 6);
    expect(heatAt(4)).toBeLessThan(1);
    expect(heatAt(10)).toBeLessThan(0.25);
    expect(heatAt(30)).toBe(0);
    expect(flameLevel(1)).toBe(6);
    expect(flameLevel(0.05)).toBe(0); // embers
    expect(flameLevel(0)).toBe(-1);
  });
});

describe('the fire, driven by the engine', () => {
  it('flares once for every item that falls in, and the items glide in without a jump', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 40); // out at (500,519) going north
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 4))).toBe(4); // (500,519)…(500,516)
    const inc = sim.place('incinerator', 500, 515, 0);
    expect(inc.ok).toBe(true);
    sim.run(60);
    sim.ensureCompiled();
    const flow = new CellFlow();
    flow.setPieces(buildPieces(sim, beltPiece, 20));
    const fire = new PitFire();
    const before = sim.consumed[itemIdx('iron_ore')]!;
    let flares = 0, prev = 0, rising = false, maxHeat = 0, fell = 0, lastPit: { x: number; y: number } | null = null, maxStep = 0;
    let lowest = Infinity, began = 0;
    for (let k = 0; k < 600 * 6; k++) {
      if (k % 6 === 0) sim.step();
      const t = sim.tick + (k % 6) / 6;
      let pit: { x: number; y: number } | null = null;
      flow.each(sim, t, [400, 400, 620, 620], (it) => { if (it.d > 0) fell = Math.max(fell, it.d); if (it.y < 516) pit = { x: it.x, y: it.y }; });
      // The item on its way in moves smoothly (while one is in sight from frame to frame).
      const p = pit as { x: number; y: number } | null;
      if (p && lastPit) maxStep = Math.max(maxStep, Math.hypot(p.x - lastPit.x, p.y - lastPit.y));
      lastPit = p;
      fire.update(sim, t);
      const h = fire.heat(inc.id!);
      maxHeat = Math.max(maxHeat, h);
      // A fresh flare: the heat turns from steady or falling to rising (it never rises but at a fall).
      if (h > prev + 1e-9 && !rising) flares++;
      rising = h > prev + 1e-9;
      prev = h;
      // A full line of one item a second: once it burns, it burns on between flares (no strobe to embers).
      if (k > 60 * 6 && sim.consumed[itemIdx('iron_ore')]! - before < 30_000) lowest = Math.min(lowest, h);
      began = fire.bursts(inc.id!)?.n ?? 0;
    }
    const burnt = (sim.consumed[itemIdx('iron_ore')]! - before) / 1000;
    expect(burnt).toBeGreaterThan(20);
    expect(Math.abs(flares - burnt)).toBeLessThanOrEqual(2); // one flare an item (the last may still be falling)
    expect(Math.abs(began - burnt)).toBeLessThanOrEqual(2); // and a burst for each (a second apart: none skipped)
    expect(lowest).toBeGreaterThan(0.35); // steady between them: a flame, not embers
    expect(maxHeat).toBeLessThanOrEqual(1);
    expect(fell).toBeGreaterThan(0.5); // they were seen falling in
    expect(maxStep).toBeLessThan(0.3);
    // The silo is empty: the fire dies down.
    expect(fire.heat(inc.id!)).toBe(0);
  });
});

/** A sink fed through port 1 by a routing block (a fake graph: what PitFire reads of it). */
function forkFed(ribbonOnPort1 = false): { sim: Sim; node: SinkNode } {
  const node = new SinkNode(77);
  node.inE = [0];
  const src = ribbonOnPort1 ? { kind: 'chain', fluid: false } : { kind: 'fork' };
  const graph = { version: 1, nodes: [node, src], chains: [], eSrc: Int32Array.of(1), eDst: Int32Array.of(0), eDstPort: Int32Array.of(1) };
  return { sim: { graph, tick: 0 } as unknown as Sim, node };
}

describe('the burst, from the sink\'s record (D125)', () => {
  it('a routing block\'s item bursts a tick after the engine took it, tinted by its item', () => {
    const { sim, node } = forkFed();
    const fire = new PitFire();
    (sim as { tick: number }).tick = 101;
    node.burnTick = 100; node.burnItem = 3; node.burnPort = 1;
    fire.update(sim, 100.5);
    expect(fire.bursts(77)).toBeUndefined(); // not yet: it burns at burnTick + 1
    expect(fire.heat(77)).toBe(0);
    fire.update(sim, 101.2);
    const b = fire.bursts(77)!;
    expect(b.n).toBe(1);
    expect(b.at[0]).toBe(101);
    expect(b.item[0]).toBe(3);
    expect(b.seed[0]).toBe(burstSeed(77, 100));
    expect(fire.heat(77)).toBeGreaterThan(0.3);
    // Seen again on later frames: the same burst, not a new one.
    fire.update(sim, 102);
    expect(fire.bursts(77)!.n).toBe(1);
  });

  it('a record ahead of the sim (a catch-up\'s warm-up) is ignored', () => {
    const { sim, node } = forkFed();
    const fire = new PitFire();
    (sim as { tick: number }).tick = 101;
    node.burnTick = 105; node.burnItem = 2; node.burnPort = 1;
    fire.update(sim, 106.5);
    expect(fire.bursts(77)).toBeUndefined();
    expect(fire.heat(77)).toBe(0);
    // Nothing burnt since a compile or a warm-up rolled back: −1.
    node.burnTick = -1;
    fire.update(sim, 107);
    expect(fire.bursts(77)).toBeUndefined();
  });

  it('a ribbon\'s item is left to the ribbon\'s glide (not burst at once from the record)', () => {
    const { sim, node } = forkFed(true);
    const fire = new PitFire();
    (sim as { tick: number }).tick = 101;
    node.burnTick = 100; node.burnItem = 3; node.burnPort = 1;
    fire.update(sim, 101.5);
    expect(fire.bursts(77)).toBeUndefined();
  });

  it('items too close together feed the flame but start no new burst; then one begins again', () => {
    const { sim, node } = forkFed();
    const fire = new PitFire();
    const burn = (tick: number): void => { node.burnTick = tick; node.burnItem = 1; node.burnPort = 1; (sim as { tick: number }).tick = tick + 1; fire.update(sim, tick + 1); };
    burn(100);
    burn(102); // 2 ticks on: under BURST.gap
    expect(fire.bursts(77)!.n).toBe(1);
    expect(fire.heat(77)).toBeGreaterThan(0.3); // the flame restarted with it
    burn(100 + BURST.gap);
    expect(fire.bursts(77)!.n).toBe(2);
    // The slots go round: the oldest is taken by the next.
    for (let i = 2; i <= BURST.slots; i++) burn(100 + BURST.gap * (i + 1));
    const b = fire.bursts(77)!;
    expect(b.n).toBe(BURST.slots + 1);
    expect(b.at[0]).toBe(100 + BURST.gap * (BURST.slots + 1) + 1);
  });
});

describe('the burst, driven by the engine (D125): a sorter\'s side straight into an incinerator', () => {
  it('a burst for every item burnt, each a tick after the engine took it, and the fire out when nothing comes', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'sand', 30); // out at (500,519) going north
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3); // (500,519)…(500,517)
    expect(sim.place('sorter', 500, 516, 0).ok).toBe(true); // nothing chosen: everything to its sides
    const inc = sim.place('incinerator', 501, 516, 0); // against its east side
    expect(inc.ok).toBe(true);
    sim.ensureCompiled();
    const node = sim.graph.nodeByEnt.get(inc.id!) as SinkNode;
    expect(node.kind).toBe('sink');
    const fire = new PitFire();
    const before = sim.consumed[itemIdx('sand')]!;
    let seen = 0, late = 0, lit = 0;
    for (let k = 0; k < 500 * 6; k++) {
      if (k % 6 === 0) sim.step();
      const t = sim.tick + (k % 6) / 6;
      fire.update(sim, t);
      const b = fire.bursts(inc.id!);
      if (b && b.n > seen) {
        seen = b.n;
        // The new burst began a tick after the engine's record (drawn a tick behind the engine).
        if (b.at[(b.n - 1) % BURST.slots] !== node.burnTick + 1) late++;
        expect(b.item[(b.n - 1) % BURST.slots]).toBe(itemIdx('sand'));
      }
      if (fire.heat(inc.id!) > 0.12) lit++;
    }
    const burnt = (sim.consumed[itemIdx('sand')]! - before) / 1000;
    expect(burnt).toBe(30);
    expect(node.burns).toBe(30);
    expect(Math.abs(seen - burnt)).toBeLessThanOrEqual(1);
    expect(late).toBe(0);
    expect(lit).toBeGreaterThan(30 * 6);
    expect(fire.heat(inc.id!)).toBe(0); // the silo is empty: out
  });
});

describe('the burst\'s geometry (D125)', () => {
  it('steady heat: a fast feed holds the flame up, a slow one does not, and it dies once the feed stops', () => {
    expect(steadyHeat(10, 3)).toBeGreaterThan(0.4); // one a second
    expect(steadyHeat(4, 3)).toBeGreaterThanOrEqual(steadyHeat(10, 3)); // faster: higher
    expect(steadyHeat(30, 3)).toBe(0); // one in three seconds: flares only
    expect(steadyHeat(10, 12)).toBeGreaterThan(0); // a beat late: still burning
    expect(steadyHeat(10, 12.5 + 8)).toBe(0); // stopped: out
    expect(steadyHeat(Infinity, 1)).toBe(0);
  });

  it('sparks leap up out of the throat and fade; the puff rises, swells and thins; nothing outside their lives', () => {
    const o: SparkAt = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, a: 0, s: 0 };
    const seed = burstSeed(5, 1234);
    for (let k = 0; k < BURST.sparks; k++) {
      expect(sparkAt(seed, k, -0.1, o).a).toBe(0);
      expect(sparkAt(seed, k, BURST.sparkLife, o).a).toBe(0);
      const z1 = sparkAt(seed, k, 1, o).z, a1 = o.a;
      const z3 = sparkAt(seed, k, 3, o).z;
      expect(z3).toBeGreaterThan(z1); // up
      expect(a1).toBeGreaterThan(0.9);
      expect(Math.hypot(o.x, o.y)).toBeLessThan(0.5); // round the pit, within its tile
      // The same burst, the same spark: stable from frame to frame and screen to screen.
      expect(sparkAt(seed, k, 3, o).z).toBe(z3);
    }
    const q: PuffAt = { x: 0, y: 0, z: 0, s: 0, a: 0 };
    expect(puffAt(seed, 0, q).a).toBe(0); // a beat after the flare
    const early = { ...puffAt(seed, BURST.puffDelay + 2, q) }, late = { ...puffAt(seed, BURST.puffDelay + BURST.puffLife * 0.8, q) };
    expect(late.z).toBeGreaterThan(early.z);
    expect(late.s).toBeGreaterThan(early.s);
    expect(late.a).toBeLessThan(early.a);
    expect(late.x - late.y).toBeGreaterThan(0); // drifting right on screen
    expect(puffAt(seed, BURST_LIFE, q).a).toBe(0);
    expect(burstGlow(1).k).toBe(1);
    expect(burstGlow(BURST.sparkLife).k).toBe(0);
    for (let i = 0; i < 200; i++) { const h = hash01(seed, i, i & 3); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  });

  it('tints: the item\'s hue at full brightness, the flame back to its own colours as the tint fades', () => {
    expect(brighten('#6b5a4e')).toBe('#ffd6ba'); // slag: a warm peach, not mud
    expect(brighten('#000000')).toBe('#000000');
    const slag = burstTints(itemIdx('slag'));
    expect(slag.smoke).not.toBe(0xffffff);
    expect(burstTints(-1).flame).toBe(0xffffff);
    expect(towards(0x804020, 0)).toBe(0xffffff);
    expect(towards(0x804020, 1)).toBe(0x804020);
  });
});
