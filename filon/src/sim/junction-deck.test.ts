// junction-deck.test.ts — a junction's deck ends take only line pieces; its tunnel's sides anything;
// junctions chain along their tunnels (D158; owner, 2026-10-19: « the junction should prevent
// putting something other than a ribbon on the two sides where the junction brings the items, but not
// on the other two sides. You can have items going below multiple junctions in a row »). Its deck runs
// along its rotation's axis: north–south turned 0 or 2, east–west turned 1 or 3. Checked on every side
// for every rotation, both ways round (the junction first, the other first); a junction turning its
// deck by itself where only the other axis fits; a line under three junctions in a row at its pace,
// online and offline bit for bit; a base from before the rule keeping what stands at a deck end.
import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { isSpanTile, spanTile } from './flow/chain';
import { catchUp } from './offline/catchup';
import { deserialize, serialize, type SaveData } from './serialize';
import type { Sim } from './state';
import { deckBlocks } from './systems/build';
import { line, stockedSilo, testSim, testSource } from './testkit';
import { DX, DY, type Rot } from './types';
import { tileIndex } from './world/grid';

const J = 520; // the junction under test stands on (J, J)
const ROTS: readonly Rot[] = [0, 1, 2, 3];
const SIDE = ['north', 'east', 'south', 'west'];

/** A fresh base with every plan, plates and wire for what the checks place. */
function base(): Sim {
  const sim = testSim();
  sim.done.add('xp_swift'); // swift ribbons (a research): granted outside the commands
  sim.rebuildDerived();
  sim.grant('iron_plate', 200);
  sim.grant('copper_wire', 50);
  sim.grant('gear', 50);
  return sim;
}

/** What may stand on a junction's side: line pieces anywhere; the others on its tunnel's sides only. */
const THINGS: ReadonlyArray<{ def: string; line: boolean }> = [
  { def: 'ribbon', line: true },
  { def: 'swift_ribbon', line: true },
  { def: 'skybridge', line: true },
  { def: 'router', line: false },
  { def: 'mast', line: false },
  { def: 'conduit', line: false },
  { def: 'incinerator', line: false },
];

describe('a junction’s deck ends take only line pieces (D158)', () => {
  for (const rot of ROTS) {
    it(`turned ${rot}: its deck runs ${rot & 1 ? 'east–west' : 'north–south'}; on each side, what may stand there, placed after it or before it`, () => {
      for (let d = 0 as Rot; d < 4; d = (d + 1) as Rot) {
        const deck = ((rot ^ d) & 1) === 0, x = J + DX[d]!, y = J + DY[d]!;
        for (const t of THINGS) {
          const want = t.line || !deck ? 'ok' : 'junction_deck';
          // The junction first, then the thing beside it.
          const a = base();
          expect(a.place('crossing', J, J, rot, undefined, true).ok).toBe(true);
          expect(a.canPlace(t.def, x, y, d).reason, `${t.def} ${SIDE[d]} of a junction turned ${rot}`).toBe(want);
          // The thing first, then the junction (turned by the player: no turning by itself).
          const b = base();
          const p = b.place(t.def, x, y, d);
          expect(p.ok, `${t.def}: ${p.reason}`).toBe(true);
          expect(b.canPlace('crossing', J, J, rot).reason, `a junction turned ${rot} with ${t.def} ${SIDE[d]} of it`).toBe(want);
        }
        // Another junction: beside it on its tunnel's side turned the same way (a row), never at its deck's end,
        // never turned across (its own deck would come down on this one).
        const c = base();
        expect(c.place('crossing', J, J, rot, undefined, true).ok).toBe(true);
        expect(c.canPlace('crossing', x, y, rot).reason).toBe(deck ? 'junction_deck' : 'ok');
        expect(c.canPlace('crossing', x, y, ((rot + 1) & 3) as Rot).reason).toBe('junction_deck');
      }
    });
  }

  it('a building of several tiles: refused where any of its tiles is at a deck end, not along the tunnel', () => {
    const sim = base();
    expect(sim.place('crossing', J, J, 0).ok).toBe(true);
    expect(sim.canPlace('silo', J, J - 2, 0).reason).toBe('junction_deck'); // its bottom row on the north end
    expect(sim.canPlace('silo', J - 1, J + 1, 0).reason).toBe('junction_deck'); // its top row over the south end
    expect(sim.canPlace('silo', J + 1, J - 1, 0).ok).toBe(true); // east: the tunnel's side
    expect(sim.canPlace('silo', J + 1, J - 2, 0).ok).toBe(true); // a diagonal
  });

  it('a junction turns its deck by itself where only the other axis comes down on ribbons; turned by the player, it is refused', () => {
    const sim = base();
    expect(sim.place('router', J, J - 1, 0).ok).toBe(true); // north of the tile
    expect(sim.placementRot('crossing', J, J, 0)).toBe(1);
    expect(sim.placementRot('crossing', J, J, 0, true)).toBe(0);
    expect(sim.canPlace('crossing', J, J, 0).reason).toBe('junction_deck');
    const r = sim.place('crossing', J, J, 0);
    expect(r.ok).toBe(true);
    expect(sim.entityAt(J, J)!.rot).toBe(1); // its deck east–west: the router on its tunnel's side
    // Something on both axes: neither way fits.
    const both = base();
    expect(both.place('router', J, J - 1, 0).ok).toBe(true);
    expect(both.place('mast', J + 1, J, 0).ok).toBe(true);
    expect(both.place('crossing', J, J, 0).reason).toBe('junction_deck');
    // Turning one is re-placing it turned: across, it is another junction (refunded, re-laid); half round, the same one.
    const turn = base();
    expect(turn.place('crossing', J, J, 0).ok).toBe(true);
    expect(turn.canPlace('crossing', J, J, 2).reason).toBe('occupied');
    expect(turn.place('crossing', J, J, 1, undefined, true).ok).toBe(true);
    expect(turn.entityAt(J, J)!.rot).toBe(1);
  });
});

/** The row's line (y): clear of the Heart (5 × 5 round (512, 512)). */
const Y = 492;

/**
 * A line east along y `Y` from a silo of iron ore, under three junctions in a row (510–512, upright:
 * their decks north–south), into an incinerator at (517, Y); over each junction a line north from a
 * silo of sand of its own into an incinerator at Y − 4. Each silo hands out by one outlet, its other
 * one facing a mast (a silo handing out by both into lines counts a few items too many burnt offline,
 * junctions or not: a separate matter, noted in D158).
 */
function row(): Sim {
  const sim = base();
  for (const x of [510, 511, 512]) expect(sim.place('crossing', x, Y, 0).ok).toBe(true);
  const silo = (x: number, y: number, item: string, mastX: number): void => {
    stockedSilo(sim, x, y, 0, item, 1000); // out at (x, y − 1) and (x + 1, y − 1)
    expect(sim.place('mast', mastX, y - 1, 0).ok).toBe(true);
  };
  silo(505, Y + 1, 'iron_ore', 505); // out at (506, Y)
  expect(sim.placeBelts('ribbon', line(506, Y, 1, 11))).toBe(8); // 506–516, the three junctions kept
  expect(sim.place('incinerator', 517, Y, 0).ok).toBe(true);
  silo(509, Y + 4, 'sand', 509); // out at (510, Y + 3)
  silo(510, Y + 7, 'sand', 510); // out at (511, Y + 6)
  silo(512, Y + 9, 'sand', 513); // out at (512, Y + 8)
  for (const [x, k] of [[510, 3], [511, 6], [512, 8]] as const) {
    expect(sim.placeBelts('ribbon', line(x, Y + k, 0, k + 4))).toBe(k + 3); // up to Y − 3, its junction kept
    expect(sim.place('incinerator', x, Y - 4, 0).ok).toBe(true);
  }
  return sim;
}

const burnt = (sim: Sim, item: string): number => sim.consumed[itemIdx(item)]! / 1000;

describe('a line under several junctions in a row (D158)', () => {
  it('runs under each in turn, a cell over each at its pace (D121): one item a step through the row, and every line over them delivers', () => {
    const sim = row();
    sim.ensureCompiled();
    const c = sim.chainAt(506, Y)!;
    expect(c).toBe(sim.chainAt(516, Y));
    expect(Array.from(c.tiles)).toEqual([
      ...[506, 507, 508, 509].map((x) => tileIndex(x, Y)),
      ...[510, 511, 512].map((x) => spanTile(tileIndex(x, Y), 1)), // under each junction in turn
      ...[513, 514, 515, 516].map((x) => tileIndex(x, Y)),
    ]);
    // Each line over: its own cell over its junction, northwards.
    for (const x of [510, 511, 512]) expect(Array.from(sim.chainAt(x, Y - 1)!.tiles).filter(isSpanTile)).toEqual([spanTile(tileIndex(x, Y), 0)]);
    // The first ore reaches the incinerator after the line's 11 cells (8 world tiles and 3 under the
    // row), a step (10 ticks) a cell, give or take the steps' phase: the row costs its three tiles.
    let first = -1;
    for (let k = 0; k < 400 && first < 0; k++) { sim.step(); if (burnt(sim, 'iron_ore') > 0) first = sim.tick; }
    expect(first).toBeGreaterThanOrEqual(100);
    expect(first).toBeLessThanOrEqual(140);
    const ore0 = burnt(sim, 'iron_ore'), sand0 = burnt(sim, 'sand');
    sim.run(6000); // ten minutes at 60/min on the line under, 60/min on each line over
    expect(burnt(sim, 'iron_ore') - ore0).toBeGreaterThanOrEqual(598);
    expect(burnt(sim, 'sand') - sand0).toBeGreaterThanOrEqual(3 * 598);
  });

  it('turned east–west, the same row carries the same: the engine reads no junction’s rotation', () => {
    const a = row(), b = row();
    for (const x of [510, 511, 512]) b.entityAt(x, Y)!.rot = 1; // as a save of a turned row (the deck rule aside)
    b.dirty = true;
    for (const sim of [a, b]) sim.run(3000);
    expect(burnt(b, 'iron_ore')).toBe(burnt(a, 'iron_ore'));
    expect(burnt(b, 'sand')).toBe(burnt(a, 'sand'));
  });

  it('offline as online, bit for bit: the twin through the row, flowing, backed up under it, flowing again', () => {
    const a = row(), b = row();
    for (const sim of [a, b]) sim.run(600);
    const both = (ticks: number): void => {
      a.run(ticks);
      catchUp(b, ticks, { noDirect: true });
      expect(burnt(b, 'iron_ore')).toBe(burnt(a, 'iron_ore'));
      expect(burnt(b, 'sand')).toBe(burnt(a, 'sand'));
      expect(b.hash()).toBe(a.hash());
    };
    both(6000);
    // Its incinerator gone, the line backs up: a full cell under each junction, offline as online.
    for (const sim of [a, b]) expect(sim.remove(517, Y)).toBe(true);
    both(6000);
    for (const sim of [a, b]) {
      const c = sim.chainAt(506, Y)!;
      expect(Array.from(c.tiles).every((t, i) => !isSpanTile(t) || c.cells[i]! > 0)).toBe(true);
    }
    // Back, the items that waited under the row go on.
    const ore = burnt(a, 'iron_ore');
    for (const sim of [a, b]) expect(sim.place('incinerator', 517, Y, 0).ok).toBe(true);
    both(24_000);
    expect(burnt(a, 'iron_ore')).toBeGreaterThan(ore + 100);
  });
});

/** An old save's layout: `def` at (x, y, rot), which no command lays there now, written into the save and loaded. */
function grandfathered(sim: Sim, def: string, x: number, y: number, rot: Rot): Sim {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
  d.ents.push(d.nextId, buildingIdx(def), x, y, rot, 0, 0);
  d.nextId++;
  return deserialize(d, testSource());
}

describe('a base from before the rule (D158)', () => {
  it('keeps a router at a junction’s deck end: it loads, its items still pass, the junction lists it; laying it again there is refused', () => {
    const sim = base();
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 1000); // out at (500, 519)
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3); // 519–517
    expect(sim.place('crossing', 500, 516, 0).ok).toBe(true); // upright: the line rides its deck north
    expect(sim.place('incinerator', 500, 514, 0).ok).toBe(true);
    expect(sim.canPlace('router', 500, 515, 0).reason).toBe('junction_deck');
    const old = grandfathered(sim, 'router', 500, 515, 0);
    expect(deckBlocks(old, buildingIdx('crossing'), 500, 516, 0)).toEqual([[500, 516, 500, 515]]);
    old.run(3000);
    expect(burnt(old, 'iron_ore')).toBeGreaterThan(200); // through the junction, into the router, into the incinerator
    const back = deserialize(JSON.parse(JSON.stringify(serialize(old))) as SaveData, testSource());
    expect(back.hash()).toBe(old.hash());
    // Taken down, it does not go back there.
    expect(back.remove(500, 515)).toBe(true);
    expect(back.canPlace('router', 500, 515, 0).reason).toBe('junction_deck');
    expect(back.canPlace('ribbon', 500, 515, 0).ok).toBe(true);
  });
});
