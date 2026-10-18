// building-facts.ts — what the building card says about a building, derived from the content
// tables and the colony's research, never written by hand: footprint, power drawn or made, and
// by kind the figures that matter (a ribbon's throughput and speed, what a drill mines and how
// fast, a machine's unlocked recipes per minute, store sizes, reaches, fuel), how a routing
// block hands items on (the spec of the card's little diagram), where it may stand, its ports,
// what it replaces, and its cost. The building's own `desc` (content) says in plain words what
// it is for and how to hook it up; these facts are the figures beside it.
//
// Pure text and item indices, no DOM: the card (building-card.ts), the tests and any other
// surface share one derivation. Formulas mirror the engine's (graph/compile.ts: research speed,
// the tower's ×4, generator modifiers, accumulator size). Locked things stay hidden (D27): recipes not
// yet researched are left out, and so are locked buildings in the « replaces » list.
import { BAL } from '@/content/balance';
import {
  BUILDING_IDS, buildingDef, buildingIdx, costOf, itemIdx, recipeDef, recipesFor, revealOf,
} from '@/content/registry';
import { nodeName } from '@/content/research';
import type { BuildingDef, ItemDef, Side } from '@/content/types';
import { COMMON_DEPOSITS } from '@/content/world';
import { ITEMS } from '@/content/items';
import { num, rate } from '@/i18n/format';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { EPOCH, TPS } from '@/sim/constants';
import { climbOf, isLinkPoint, linkPoint, linkable } from '@/sim/power/links';
import type { Mods } from '@/sim/research/modifiers';
import type { Sim } from '@/sim/state';
import { throughputMu, tradeLevel } from '@/sim/trade';
import { TP_PAD } from '@/render/art/recipes/buildings';
import { itemRef } from './mention';

/** The ores set in cliff faces (D87: quartz), what a face cutter cuts. */
const FACE_ORES = (Object.entries(ITEMS) as Array<[string, ItemDef]>).filter(([, it]) => it.face).map(([id]) => id);
import { feeText, minutes } from './trade-view';

/** What the facts read from the colony: its research (unlocks, modifiers). */
export interface FactCtx {
  unlocked(unlock: string): boolean;
  readonly mods: Readonly<Mods>;
}

/** The facts' view of a colony. */
export const factCtx = (sim: Sim): FactCtx => ({ unlocked: (u) => sim.unlocked(u), mods: sim.mods });

/**
 * One labelled line: item icons (indices), then text. `k` names the fact (tests, CSS). A text that
 * names an item does it through `itemRef` (mention.ts): the card shows its icon there; `plain()` reads it.
 */
export interface FactRow { readonly k: string; readonly label: string; readonly text: string; readonly items?: readonly number[] }

export interface ItemRate { readonly item: number; readonly perMin: number }
export interface RecipeFact { readonly name: string; readonly ins: readonly ItemRate[]; readonly outs: readonly ItemRate[] }

/**
 * How a routing block hands items on, as the card draws it. The block faces north (its front),
 * so S is its back. Tones: `a` the main path (the chosen item, the first choice), `b` the other
 * one, `in` the way in; `dashed`: used only once the first choice is full.
 */
/** Lines of a diagram: a, b (the rule's two ways), in (the way in); pin / pout: a building's inlets and outlets (the world's port colours). */
export type RuleTone = 'a' | 'b' | 'in' | 'pin' | 'pout';
export type RuleFlow = 'in' | 'out' | 'both';
export interface RuleSide { readonly flow: RuleFlow; readonly tone: RuleTone; readonly dashed?: boolean }
export interface RuleLegend { readonly tone: RuleTone; readonly flow: RuleFlow; readonly dashed?: boolean; readonly text: string }
export interface RuleFact {
  /** `block`: a routing block and its four sides; `cross`: two lines straight through; `bridge`: a leap. */
  readonly shape: 'block' | 'cross' | 'bridge';
  /** Has a front (sorters, gates): drawn with a chevron; a distributor works the same every way. */
  readonly directed?: boolean;
  readonly sides?: Partial<Record<Side, RuleSide>>;
  readonly legend: readonly RuleLegend[];
}

export interface BuildingFacts {
  readonly id: string;
  readonly name: string;
  /** Category · footprint. */
  readonly sub: string;
  readonly desc: string;
  /**
   * What the card says in words: the description's first sentence, only for a building whose card
   * shows nothing of how it works (no recipe, no routing rule, no figure of its own) — show, then
   * tell (owner, 2026-10-13: "there's often too much text… rather show than tell"). Null: none.
   */
  readonly brief: string | null;
  /**
   * Its ports, drawn on the card as its footprint with arrows in and out (null: it has none);
   * `pad`: the part of the footprint it stands on when the rest is a scorched apron nothing else
   * may take (the trade post's, D62: a local rect), null otherwise.
   */
  readonly ports: { readonly w: number; readonly h: number; readonly list: readonly PortFact[]; readonly pad: readonly [number, number, number, number] | null } | null;
  /** The research it still waits for (null once unlocked). */
  readonly locked: string | null;
  readonly rule: RuleFact | null;
  /** A machine's unlocked recipes, per minute at the colony's research (null: not a machine). */
  readonly recipes: readonly RecipeFact[] | null;
  readonly rows: readonly FactRow[];
  readonly cost: ReadonlyArray<{ item: number; mu: number }>;
}

/** A port as the card draws it: its tile in the unrotated footprint (front = N, up), its side, in or out. */
export interface PortFact { readonly x: number; readonly y: number; readonly side: Side; readonly io: 'in' | 'out' }

const defOf = (id: string): BuildingDef => buildingDef(buildingIdx(id)) as BuildingDef;
const items = (list: readonly string[]): number[] => list.map((id) => itemIdx(id));
/** « A, B et C » in the current language. */
const listOf = (parts: readonly string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(parts);
const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** kW as « 300 kW », from 1 000 up as « 1,5 MW ». */
export function kwText(kw: number): string {
  return kw >= 1000 ? t('card.mw', { v: num(kw / 1000) }) : t('insp.kw', { v: num(kw) });
}

/**
 * The first sentence of a description: up to the first . ! ? or … that a capital follows. The
 * build tip shows only it, so a `desc` opens with a sentence that stands on its own.
 */
export function firstSentence(s: string): string {
  const m = /^(.+?[.!?…])\s+(?=\p{Lu})/u.exec(s);
  return m ? m[1]! : s;
}

// ── power ──────────────────────────────────────────────────────────────────

/** What it draws or makes at the colony's research (the grid, the weather and the load do the rest). */
function powerText(b: BuildingDef, m: Readonly<Mods>): string | null {
  if (b.kind === 'hearth') return null; // never on a card; its own panel tells its power
  const acc = b.accumulator;
  if (acc) {
    return t('card.power.acc', {
      kwmin: t('card.kwmin', { v: num(Math.floor((acc.kwMin * m.accCap) / 1000)) }),
      kw: kwText(Math.floor((acc.kw * m.accRate) / 1000)),
    });
  }
  const g = b.gen;
  if (g) {
    // As the graph compiler: base × the kind's research × generators (Sunheart keystone).
    const out = (mul: number): string => kwText(Math.floor((g.kw * mul * m.genOut) / 1e6));
    switch (b.kind) {
      case 'wind': return t('card.power.wind', { kw: out(m.windOut) });
      case 'solar': return t('card.power.sun', { kw: out(m.solarOut) });
      case 'geothermal': return t('card.power.geo', { kw: out(m.geoOut) });
      default: return t('card.power.gen', { kw: out(1000) });
    }
  }
  const on = b.kw ?? 0, idle = b.idleKw ?? on;
  if (on <= 0) return t('card.power.none');
  return idle === on ? t('card.power.flat', { on: kwText(on) }) : t('card.power.draw', { on: kwText(on), idle: kwText(idle) });
}

// ── by kind ────────────────────────────────────────────────────────────────

/** The figures of what it does, by kind. */
function kindRows(def: number, b: BuildingDef, m: Readonly<Mods>): FactRow[] {
  const rows: FactRow[] = [];
  const add = (k: string, label: string, text: string, icons?: readonly number[]): void => { rows.push({ k, label, text, items: icons }); };
  switch (b.kind) {
    case 'belt': case 'conduit': case 'bridge': {
      const bt = b.belt;
      if (!bt) break;
      if (b.kind === 'conduit') add('rate', t('card.rate'), rate(bt.perMin), items(['water']));
      else add('rate', t('card.rate'), t('card.rate.ribbon', { rate: rate(bt.perMin), density: t('card.density', { n: BAL.beltDensity }) }));
      // Tiles a second, to one decimal: a ribbon moves a tile a step, perMin steps a minute (D57); a conduit's water flows on.
      const v = Math.round((b.kind === 'conduit' ? TPS / bt.ticksPerTile : bt.perMin / 60) * 10) / 10;
      add('speed', t('card.speed'), t('card.speed.tiles', { n: v, v: num(v) }));
      break;
    }
    case 'fork':
      add('buffer', t('card.buffer'), t('card.items', { n: BAL.forkBufItems * b.w * b.h }));
      break;
    case 'drill': {
      const d = b.drill;
      if (!d) break;
      if (d.ground) add('mines', t('card.mines'), t('card.mines.ground'), items([d.ground]));
      else if (d.face) add('mines', t('card.mines'), t('card.mines.face'), items(FACE_ORES)); // D87: the wall behind it
      else add('mines', t('card.mines'), t('card.mines.deposit'), items(COMMON_DEPOSITS.map(([it]) => it)));
      const bonus = d.capMult !== undefined && d.capMult !== 1000 ? ` · ${t('card.drill.bonus', { m: num(d.capMult / 1000) })}` : '';
      add('rate', t('card.rate'), t('card.drill.rate', { rate: rate(d.perMin) }) + bonus);
      break;
    }
    case 'server':
      // AI tokens a minute (D68): the claim's research uses them before CrierBelt's; what it leaves is lost.
      if (b.server) add('tokens', t('card.tokens'), t('card.server.v', { v: t('unit.ktokens', { v: num(b.server.tokensPerMin / 1000) }) }));
      break;
    case 'pump':
      add('mines', t('card.mines'), itemRef('water'));
      break;
    case 'excavator':
      add('reach', t('card.reach'), t('card.around', { n: BAL.digReach })); // from its edge (D54)
      add('yields', t('card.yields'), t('card.dig.yield'), items(['stone', 'iron_ore', 'copper_ore']));
      add('store', t('card.store'), t('card.items', { n: BAL.excavatorCap }), items(['stone']));
      break;
    case 'backfiller':
      add('reach', t('card.reach'), t('card.radius', { n: BAL.fillReach }));
      add('fills', t('card.fills'), t('card.fill.cost', { water: num(BAL.fillRubble.shallow ?? 0), salt: num(BAL.fillRubble.salt ?? 0) }), items(['stone']));
      add('store', t('card.store'), t('card.items', { n: BAL.backfillerCap }), items(['stone']));
      break;
    case 'storage':
      if (b.storageCap) add('store', t('card.store'), t('card.store.single', { n: num(b.storageCap) }));
      break;
    case 'lab':
      // D122: a lab takes nothing in and holds no store — one project at a time, on its tokens, while
      // it has power. The autonomous lab also computes, into the claim's pool like a server.
      add('runs', t('card.lab.runs'), t('card.lab.runs.v'));
      if (b.server) add('tokens', t('card.tokens'), t('card.server.v', { v: t('unit.ktokens', { v: num(b.server.tokensPerMin / 1000) }) }));
      break;
    case 'generator': {
      const g = b.gen;
      if (!g?.fuel) break;
      const fuel = itemIdx(g.fuel), per = g.fuelPerMin ?? 0;
      // Under one a minute it reads better as « 1 every 30 min ».
      const text = per > 0 && per < 1
        ? t('card.fuel.every', { item: itemRef(fuel), d: minutes(Math.round(1 / per)) })
        : t('card.fuel.rate', { item: itemRef(fuel), rate: rate(per) });
      add('fuel', t('card.fuel'), text);
      // A steam boiler drinks water too (D114), by conduit from a pump.
      if (g.water) add('water', t('card.water'), t('card.fuel.rate', { item: itemRef(itemIdx('water')), rate: rate(g.water) }));
      break;
    }
    case 'wind': {
      // Where the wind blows in words, never a figure for a spot (D95: the Vent view tells that), and its curve.
      const c = b.gen?.wind, f = (v: number): string => `×${num(Math.round(v / 10) / 100)}`;
      add('wind', t('card.wind'), t('card.wind.where'));
      if (c) add('curve', t('card.wind.curve'), t(c.cutOut !== undefined ? 'card.wind.curveOut' : 'card.wind.curveOn', { a: f(c.cutIn), b: f(c.rated), c: f(c.cutOut ?? 0) }));
      break;
    }
    case 'trade': {
      const level = tradeLevel(m);
      add('rate', t('card.rate'), t('insp.trade.throughput', { rate: rate(throughputMu(level) / 1000) }));
      add('fee', t('insp.trade.fee'), feeText(m.tradeFee));
      add('lift', t('insp.trade.lift'), minutes(BAL.liftDelayMin[Math.min(3, level) - 1] ?? 0));
      break;
    }
    case 'pole': {
      // A pillar of the wired grid (D25): how many wires it holds, how far they reach (Reinforced Pylons included),
      // and how many terraces they climb and clear (D78).
      const p = linkPoint(def, m);
      if (p) add('wires', t('card.wires'), t('card.wires.v', { n: p.slots, r: p.range }));
      if (p) add('climb', t('card.climb'), t('card.climb.v', { n: climbOf(def) }));
      // The fog it lifts round itself (D117: every building does, but a pillar is how a line walks it back).
      if (revealOf(b)) add('reveal', t('card.reveals'), t('card.radius', { n: revealOf(b) }));
      break;
    }
    default:
      break;
  }
  return rows;
}

/** Where it may stand: deposit / water / vent needs, inside a zone or anywhere (ribbons: dearer outside). */
function placeRow(b: BuildingDef, m: Readonly<Mods>): FactRow | null {
  if (b.kind === 'hearth') return null;
  const parts: string[] = [];
  if (b.kind === 'drill') parts.push(t(b.drill?.ground ? 'card.place.sand' : b.drill?.face ? 'card.place.face' : 'card.place.deposit'));
  if (b.kind === 'pump') parts.push(t('card.place.water'));
  if (b.kind === 'geothermal') parts.push(t('card.place.vent'));
  if (b.kind === 'belt' || b.kind === 'conduit') parts.push(t('card.place.remote', { m: num((BAL.remoteBeltCostMult * m.remoteBeltCost) / 1000) }));
  else parts.push(b.needsZone ? t('card.place.zone') : t('card.place.anywhere'));
  return { k: 'place', label: t('card.place'), text: parts.join(', ') };
}

/** What it may be placed over (D24): its replace group, wholly inside its footprint. */
function replaceRow(id: string, b: BuildingDef, ctx: FactCtx): FactRow | null {
  const g = b.replaceGroup;
  if (!g) return null;
  let text: string | null;
  if (g === 'transport') {
    text = b.kind === 'belt' ? t('card.replace.belt') : b.w * b.h > 1 ? t('card.replace.ribbons') : t('card.replace.ribbon');
  } else {
    const L = locale();
    const fits = (o: BuildingDef): boolean => Math.max(o.w, o.h) <= Math.max(b.w, b.h) && Math.min(o.w, o.h) <= Math.min(b.w, b.h);
    const names = BUILDING_IDS.filter((o) => o !== id).map(defOf)
      .filter((o) => o.replaceGroup === g && fits(o) && ctx.unlocked(o.unlock)).map((o) => o.name[L]);
    text = names.length ? t('card.replace.list', { list: listOf(names) }) : null;
  }
  return text ? { k: 'replace', label: t('card.replace'), text } : null;
}

// ── routing rule ───────────────────────────────────────────────────────────

const IN: RuleSide = { flow: 'in', tone: 'in' };
const out = (tone: RuleTone, dashed = false): RuleSide => ({ flow: 'out', tone, dashed });

/** The routing rule, Mindustry's as the graph compiler links it (canIn / canOut) and ForkNode splits it. */
function ruleOf(b: BuildingDef): RuleFact | null {
  if (b.kind === 'crossing') {
    return { shape: 'cross', legend: [{ tone: 'a', flow: 'out', text: t('card.rule.cross') }, { tone: 'b', flow: 'out', text: t('card.rule.crossOther') }] };
  }
  if (b.kind === 'bridge') return { shape: 'bridge', legend: [{ tone: 'a', flow: 'out', text: t('card.rule.bridge') }] };
  if (b.kind !== 'fork') return null;
  const back: RuleLegend = { tone: 'in', flow: 'in', text: t('card.rule.in') };
  switch (b.logic ?? 'router') {
    case 'sorter': return {
      shape: 'block', directed: true, sides: { S: IN, N: out('a'), E: out('b'), W: out('b') },
      legend: [back, { tone: 'a', flow: 'out', text: t('card.rule.chosenFront') }, { tone: 'b', flow: 'out', text: t('card.rule.othersSides') }],
    };
    case 'inverted': return {
      shape: 'block', directed: true, sides: { S: IN, N: out('b'), E: out('a'), W: out('a') },
      legend: [back, { tone: 'a', flow: 'out', text: t('card.rule.chosenSides') }, { tone: 'b', flow: 'out', text: t('card.rule.othersFront') }],
    };
    case 'overflow': return {
      shape: 'block', directed: true, sides: { S: IN, N: out('a'), E: out('b', true), W: out('b', true) },
      legend: [back, { tone: 'a', flow: 'out', text: t('card.rule.frontFirst') }, { tone: 'b', flow: 'out', dashed: true, text: t('card.rule.sidesIfFull') }],
    };
    case 'underflow': return {
      shape: 'block', directed: true, sides: { S: IN, N: out('b', true), E: out('a'), W: out('a') },
      legend: [back, { tone: 'a', flow: 'out', text: t('card.rule.sidesFirst') }, { tone: 'b', flow: 'out', dashed: true, text: t('card.rule.frontIfFull') }],
    };
    default: {
      const both: RuleSide = { flow: 'both', tone: 'a' };
      return { shape: 'block', sides: { N: both, E: both, S: both, W: both }, legend: [{ tone: 'a', flow: 'both', text: t('card.rule.all') }] };
    }
  }
}

// ── recipes ────────────────────────────────────────────────────────────────

/** A machine's unlocked recipes per minute: research speed and the machine's own (the tree's upgraded machines, D70), as the graph compiler (modules and dug floor are per building). */
function recipesOf(id: string, ctx: FactCtx): RecipeFact[] {
  const L = locale();
  const speed = (ctx.mods.craftSpeed * (buildingDef(buildingIdx(id)).speed ?? 1000)) / 1e6;
  return recipesFor(buildingIdx(id)).filter((r) => ctx.unlocked(r.unlock)).map((r) => {
    const per = (mu: number): number => (mu / 1000) * (EPOCH / r.ticks) * speed;
    return {
      name: recipeDef(r.idx).name[L],
      ins: r.ins.map((s) => ({ item: s.item, perMin: per(s.mu) })),
      // Its waste beside its product (D125): « [plate] 10 + [slag] 1 », shown, not told.
      outs: [...r.outs.map((s) => ({ item: s.item, perMin: per(s.mu) })), ...(r.waste ? [{ item: r.waste.item, perMin: per(1000 / r.waste.every) }] : [])],
    };
  });
}

// ── the whole card ─────────────────────────────────────────────────────────

export function buildingFacts(id: string, ctx: FactCtx): BuildingFacts {
  const def = buildingIdx(id);
  const b = defOf(id);
  const L = locale();
  const m = ctx.mods;
  // What it does first, then what it costs to run, where it goes and how it connects.
  const rows: FactRow[] = kindRows(def, b, m);
  const own = rows.length; // figures of its own (what it does), before the generic ones
  const power = powerText(b, m);
  if (power) rows.push({ k: 'power', label: t('card.power'), text: power });
  // D25: nothing is powered by proximity; a generator, consumer or accumulator runs once wired to a pillar.
  if (b.kind !== 'hearth' && linkable(def) && !isLinkPoint(def)) rows.push({ k: 'grid', label: t('card.grid'), text: t('card.grid.wire', { tool: t('build.link') }) });
  const place = placeRow(b, m);
  if (place) rows.push(place);
  const replace = replaceRow(id, b, ctx);
  if (replace) rows.push(replace);
  const u = b.unlock;
  const locked = u !== 'never' && !ctx.unlocked(u) ? t('card.locked', { name: nodeName(u)[L] }) : null; // a plan or a research of the tree (D33)
  const rule = ruleOf(b);
  return {
    id,
    name: b.name[L],
    sub: `${t(`build.cat.${b.category}` as MsgKey)} · ${t('card.size', { n: b.w * b.h, w: b.w, h: b.h })}`,
    desc: b.desc[L],
    brief: b.kind === 'machine' || rule || own > 0 ? null : firstSentence(b.desc[L]),
    ports: b.ports.length ? { w: b.w, h: b.h, list: b.ports.map((p) => ({ x: p.x, y: p.y, side: p.side, io: p.io })), pad: b.kind === 'trade' ? TP_PAD : null } : null,
    locked,
    rule: rule ? { ...rule, legend: rule.legend.map((l) => ({ ...l, text: cap1(l.text) })) } : null,
    recipes: b.kind === 'machine' ? recipesOf(id, ctx) : null,
    // Values read as short phrases, each opening with a capital.
    rows: rows.map((r) => ({ ...r, text: cap1(r.text) })),
    cost: costOf(buildingIdx(id)),
  };
}
