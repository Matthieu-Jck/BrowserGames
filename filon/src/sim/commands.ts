// commands.ts — the colony's API vocabulary. A Command is something the player (a script, or
// a future server replaying a log) does to a colony: each Sim command method validates it,
// applies it and appends it to `sim.log` with its tick. A SimEvent is what the colony reports
// back to the shell — ids and numbers, never text (the UI translates).
// `exec` applies one logged command; `replay` re-runs a whole log on a fresh colony founded
// with the same seeds: same log ⇒ same state hash (tested in commands.test.ts). Anything that
// mutates a colony outside these commands (sandbox helpers of window.FL) breaks replay.
import type { Emblem } from '@/content/emblem';
import type { OrderReward } from './systems/orders';
import type { MarketEvent } from '@/market/types';
import type { Sim } from './state';
import type { Blueprint } from './systems/blueprint';
import type { Rot } from './types';

export type Command =
  /** `turned`: the player turned it in hand (R): a routing block keeps that rotation over a ribbon (D98). */
  | { k: 'place'; def: string; x: number; y: number; rot: Rot; cfg?: number; turned?: boolean }
  | { k: 'remove'; x: number; y: number }
  | { k: 'recipe'; id: number; recipe: string | null }
  | { k: 'portItem'; id: number; port: number; item: string | null }
  | { k: 'forkFilter'; id: number; side: Rot; item: string | null }
  | { k: 'grant'; item: string; n: number }
  | { k: 'credits'; cents: number }
  /** Start a node; `buy`: tokens a minute bought from CrierBelt for it while it needs them (D118; absent: none). */
  | { k: 'research'; id: string; lab: number; buy?: number }
  /** Unlock a plan of the tree (D33): paid from the Heart, at once. */
  | { k: 'unlockPlan'; id: string }
  | { k: 'cancelResearch'; id: string }
  /** A family's reconversion: retired with its button (D107); kept so older logs still read, it does nothing. */
  | { k: 'respec'; branch: string }
  | { k: 'designate'; tiles: number[]; on: boolean }
  | { k: 'hearthUp' }
  /** A drifter bought, a freight route opened or closed: retired with the skydocks (D108); kept so older logs still read, they do nothing. */
  | { k: 'drifter'; dock: number }
  | { k: 'route'; from: number; to: number; item: string; ships: number }
  | { k: 'unroute'; id: number }
  /** `express` (Express Freight, cm_express): half the delay, a quarter dearer. */
  | { k: 'importOrder'; post: number; item: string; perMin: number; maxCents: number; express?: boolean }
  | { k: 'cancelOrder'; id: number }
  /** The starter contract (D101): CrierBelt's one-time offer, signed on a trade post. */
  | { k: 'starter'; post: number }
  /** The fulfilled starter contract continued at the market's price (D101). */
  | { k: 'starterGo'; id: number }
  /** One of CrierBelt's delivery orders accepted (D153): its window starts. */
  | { k: 'acceptDelivery'; id: number }
  | { k: 'spot'; item: string; side: 'sell' | 'buy'; n: number }
  /** Power wires (D25): `a` is the end the player started from (a pillar or the Hearth, usually). */
  | { k: 'link'; a: number; b: number }
  | { k: 'unlink'; a: number; b: number }
  /** Name (or rename) the claim (quest 0). */
  | { k: 'name'; name: string }
  /** The claim's emblem (the register; the Heart's flag). */
  | { k: 'emblem'; e: Emblem }
  /** A quest completed (systems/quests.ts): logged by the colony itself, or forced (debug). A
   * replay completes the unforced ones again on its own and refuses their entries. */
  | { k: 'quest'; id: string; force?: boolean }
  | { k: 'skipQuests' }
  /** Land (docs/land.md): buy a parcel, lease one by the hour, give a lease up. */
  | { k: 'buyLand'; p: number }
  | { k: 'rentLand'; p: number }
  | { k: 'endLease'; p: number }
  /** Sell a bought parcel back (D119: no research). */
  | { k: 'sellLand'; p: number }
  /** Research Queue (an_queue): the node a lab starts once its project is done (null: none). */
  | { k: 'queueResearch'; lab: number; id: string | null }
  /** The Compute Plan (cm_plan): CrierBelt's tokens at a share of the price, for a fee an hour. */
  | { k: 'tokenPlan'; on: boolean }
  /** Change the tokens a minute a running project buys (D118). */
  | { k: 'tokenBuy'; id: string; perMin: number }
  /** Floor Prices (cm_floor): the trade posts hold back an item whose bid is under this (centi-◉; null: none). */
  | { k: 'floorPrice'; item: string; cents: number | null }
  /** Auto-sell (cm_autosell, D127, D164): on (`at` a number: 0, or an older log's threshold) or off (null); what the Core receives beyond its cap is sold. */
  | { k: 'autoSell'; item: string; at: number | null }
  /** The expertises (D93): an earned one chosen into an empty slot, in place at once. */
  | { k: 'expertise'; slot: number; id: string }
  /** A réorientation: the slot's expertise replaced by `id` — paid, in place 24 h later. */
  | { k: 'reorient'; slot: number; id: string }
  /**
   * The blueprints' library (D154): a blueprint saved under a name, renamed, deleted. A paste is no
   * command of its own: its pieces are `place`s, its wires `link`s, each logged (systems/blueprint.ts).
   */
  | { k: 'bpSave'; bp: Blueprint; name: string }
  | { k: 'bpRename'; id: number; name: string }
  | { k: 'bpDelete'; id: number };

export type CommandKind = Command['k'];

export type SimEvent =
  /** Something was placed, removed or reconfigured: views rebuild, the UI refreshes. */
  | { k: 'structure' }
  /** A game minute ended (absolute world epoch). */
  | { k: 'epoch'; epoch: number }
  /** A research project (or a reconversion, id `respec:<branch>`) completed. */
  | { k: 'research'; id: string }
  /** A plan of the tree was unlocked (D33): what it unlocks can be built now. */
  | { k: 'plan'; id: string }
  /** A rock tile was dug out (and the embedded ore it gave up). */
  | { k: 'dug'; tile: number; ore: Array<{ item: number; mu: number }> }
  /** A water / salt tile was filled. */
  | { k: 'filled'; tile: number }
  /** A trade post lifted cargo at an epoch boundary (mu sold / bought, net centi-◉; `from`: the colonies its imports come from, −1 for CrierBelt itself: the starter contract). */
  | { k: 'trade'; post: number; soldMu: number; boughtMu: number; cents: number; from: number[] }
  /** Imported goods arrived at a post (or in the Hearth next to it). */
  | { k: 'delivered'; post: number; item: number; mu: number }
  /** The Crier's Gazette: events announced, started, ended at this boundary (ids and numbers). */
  | { k: 'gazette'; started: MarketEvent[]; ended: MarketEvent[]; announced: MarketEvent[] }
  /** A tutorial quest completed; its reward is in the Hearth (content/quests.ts ids; `title`: the one it granted). */
  | { k: 'quest'; id: string; title?: string }
  /** A parcel changed hands, or a lease's hour was paid (centi-◉): bought, leased, rent, lapsed (the purse could not pay), ended. */
  | { k: 'land'; p: number; what: 'bought' | 'leased' | 'rent' | 'lapsed' | 'ended' | 'sold'; cents: number }
  /** The purse went into the red (the tokens bought for research hold, D118) or back out of it (D68). */
  | { k: 'researchHeld'; held: boolean }
  /** A lab started the node queued for it (the Research Queue). */
  | { k: 'researchQueued'; id: string }
  /** An expertise's rank earned (announced once the Core mounts the Archive), or one in place at the end of its réorientation's 24 h (D93). */
  | { k: 'expertise'; id: string; rank: number; what: 'earned' | 'ready' }
  /**
   * The Gleaners (D103): their first take of a night (`night`: the notice that introduces them), and
   * at dawn what they took in the night just ended (`dawn`: item and milli-items, by item; the morning report).
   */
  | { k: 'gleaners'; what: 'night' | 'dawn'; taken: Array<[number, number]> }
  /**
   * CrierBelt's delivery orders (D153, systems/orders.ts): one posted (`cents`: its price an item; `first`: the tutorial's next step),
   * filled (`cents`: what it paid; its reward delivered), missed (its window ran out: `cents`, what its
   * `got` items were paid at the market) or an offer withdrawn, never accepted.
   */
  | { k: 'delivery'; what: 'posted' | 'filled' | 'missed' | 'withdrawn'; id: number; item: number; n: number; got: number; cents: number; reward?: OrderReward; first?: boolean }
  /** The claim climbed the standings (D153, systems/ranking.ts): its rank now and before, of how many, the claims it passed (colony indices, nearest first). */
  | { k: 'rank'; rank: number; prev: number; of: number; passed: number[] };

/** Apply one command (as logged). Returns whether the colony accepted it. */
export function exec(sim: Sim, cmd: Command): boolean {
  switch (cmd.k) {
    case 'place': return sim.place(cmd.def, cmd.x, cmd.y, cmd.rot, cmd.cfg ?? 0, cmd.turned ?? false).ok;
    case 'remove': return sim.remove(cmd.x, cmd.y);
    case 'recipe': return sim.setRecipe(cmd.id, cmd.recipe);
    case 'portItem': return sim.setPortItem(cmd.id, cmd.port, cmd.item);
    case 'forkFilter': return sim.setForkFilter(cmd.id, cmd.side, cmd.item);
    case 'grant': sim.grant(cmd.item, cmd.n); return true;
    case 'credits': sim.grantCredits(cmd.cents); return true;
    case 'research': return sim.startResearch(cmd.id, cmd.lab, cmd.buy ?? 0).ok;
    case 'unlockPlan': return sim.unlockPlan(cmd.id).ok;
    case 'cancelResearch': return sim.cancelResearch(cmd.id);
    case 'respec': return false; // retired (D107): no reconversion starts
    case 'designate': return sim.designate(cmd.tiles, cmd.on) > 0;
    case 'hearthUp': return sim.upgradeHearth().ok;
    case 'drifter': case 'route': case 'unroute': return false; // retired with the skydocks (D108)
    case 'importOrder': return typeof sim.addImport(cmd.post, cmd.item, cmd.perMin, cmd.maxCents, cmd.express ?? false) === 'number';
    case 'cancelOrder': return sim.cancelImport(cmd.id);
    case 'starter': return typeof sim.takeStarter(cmd.post) === 'number';
    case 'starterGo': return sim.continueStarter(cmd.id);
    case 'acceptDelivery': return sim.acceptDelivery(cmd.id);
    case 'spot': return 'cents' in sim.spotTrade(cmd.item, cmd.side, cmd.n);
    case 'link': return sim.link(cmd.a, cmd.b).ok;
    case 'unlink': return sim.unlink(cmd.a, cmd.b);
    case 'name': return sim.nameColony(cmd.name);
    case 'emblem': return sim.setEmblem(cmd.e);
    case 'quest': return sim.completeQuest(cmd.id, cmd.force ?? false);
    case 'skipQuests': return sim.skipTutorial();
    case 'buyLand': return sim.buyLand(cmd.p) === null;
    case 'rentLand': return sim.rentLand(cmd.p) === null;
    case 'endLease': return sim.endLease(cmd.p) === null;
    case 'sellLand': return sim.sellLand(cmd.p) === null;
    case 'queueResearch': return sim.queueResearch(cmd.lab, cmd.id);
    case 'tokenPlan': return sim.setTokenPlan(cmd.on);
    case 'tokenBuy': return sim.setTokenBuy(cmd.id, cmd.perMin);
    case 'floorPrice': return sim.setFloorPrice(cmd.item, cmd.cents);
    case 'autoSell': return sim.setAutoSell(cmd.item, cmd.at !== null); // an older log's threshold reads as on (D164)
    case 'expertise': return sim.chooseExpertise(cmd.slot, cmd.id) === null;
    case 'reorient': return sim.reorient(cmd.slot, cmd.id) === null;
    case 'bpSave': return sim.saveBlueprint(cmd.bp, cmd.name) > 0;
    case 'bpRename': return sim.renameBlueprint(cmd.id, cmd.name);
    case 'bpDelete': return sim.deleteBlueprint(cmd.id);
    default: { const never: never = cmd; return never; } // a new Command kind must be handled here
  }
}

/**
 * Re-run a command log on a colony (normally fresh, same seeds): tick up to each command's
 * tick, apply it, and finally run on to `toTick` when given.
 */
export function replay(sim: Sim, log: ReadonlyArray<{ tick: number; cmd: Command }>, toTick?: number): void {
  for (const { tick, cmd } of log) {
    if (tick > sim.tick) sim.run(tick - sim.tick);
    exec(sim, cmd);
  }
  if (toTick !== undefined && toTick > sim.tick) sim.run(toTick - sim.tick);
}
