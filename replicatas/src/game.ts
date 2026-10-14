// game.ts — the controller: owns run/meta state, the 3D scenes, the screen
// machine, and every flow transition (jump → surface → node → combat → reward).
import { SceneManager } from '@/scenes/scene-manager';
import { SpaceScene } from '@/scenes/space-scene';
import { PlanetScene } from '@/scenes/planet-scene';
import { CombatScene } from '@/scenes/combat-scene';
import { ExploreScene, type Poi } from '@/scenes/explore-scene';
import { nodeIntel } from '@/map/scanner';
import type { SurfaceMap, SurfaceNode } from '@/map/surface-gen';
import { bus } from '@/core/bus';
import { makeRng } from '@/core/rng';
import type { MetaState } from '@/core/meta';
import { addDeed } from '@/core/meta';
import { loadMeta, saveMeta, loadRun, saveRun, clearRun } from '@/core/save';
import type { RunState } from '@/core/run';
import {
  newRun, act, currentPlanet, currentSurface, jumpTo,
  buildEncounter, buildCombatConfig, applyFlareIfAny, afterCombatWin,
  gainData, gainMinerals, gainFuel, addCardToDeck, scannerLevel,
} from '@/core/run';
import {
  onDeath, noteForgeVisit, bankRunData, recordBossKill,
} from '@/core/lineage';
import { startCombat, combatResources, type Combat } from '@/combat/engine';
import { getEnemy } from '@/content/registry';
import type { EventDef, EventOutcome } from '@/content/events';
import { EVENTS } from '@/content/events';
import { tween } from '@/vfx/tween';

export interface Screen {
  root: HTMLElement;
  enter(payload?: unknown): void;
  exit?(): void;
  update?(dt: number, t: number): void;
}

export type ScreenId =
  | 'title' | 'cutscene' | 'galaxy' | 'surface' | 'combat' | 'event'
  | 'reward' | 'shop' | 'forge' | 'wake' | 'gameover' | 'ending';

type SceneKey = 'space' | 'planet' | 'combat' | 'explore' | null;

const SCENE_OF: Record<ScreenId, SceneKey> = {
  title: 'space', cutscene: 'space', galaxy: 'space',
  surface: 'explore', event: 'explore', reward: 'explore', shop: 'explore', forge: 'explore',
  wake: 'planet',
  combat: 'combat',
  gameover: 'space', ending: 'space',
};

export class Game {
  sm: SceneManager;
  space = new SpaceScene();
  planet = new PlanetScene();
  combatScene = new CombatScene();
  explore = new ExploreScene();
  meta: MetaState;
  run: RunState | null = null;
  combat: Combat | null = null;
  combatEnemies: string[] = [];
  screens = new Map<ScreenId, Screen>();
  current: ScreenId | null = null;
  private transitioning = false;
  private traveling = false;

  constructor(canvas: HTMLCanvasElement) {
    this.sm = new SceneManager(canvas);
    this.meta = loadMeta();
    this.explore.onPoiClick = (id) => this.selectNode(id);
  }

  register(id: ScreenId, screen: Screen): void {
    this.screens.set(id, screen);
    screen.root.dataset['screen'] = id;
  }

  // ---------------------------------------------------------------- screen machine

  setScreen(id: ScreenId, payload?: unknown, opts: { noFade?: boolean } = {}): void {
    const doSwap = (): void => {
      const prev = this.current ? this.screens.get(this.current) : null;
      prev?.exit?.();
      prev?.root.classList.remove('visible');
      this.current = id;
      const next = this.screens.get(id);
      if (!next) throw new Error(`screen ${id} not registered`);
      const sceneKey = SCENE_OF[id];
      if (sceneKey === 'space') this.sm.setScene(this.space.scene, this.space.camera);
      else if (sceneKey === 'planet') this.sm.setScene(this.planet.scene, this.planet.camera);
      else if (sceneKey === 'combat') this.sm.setScene(this.combatScene.scene, this.combatScene.camera);
      else if (sceneKey === 'explore') this.sm.setScene(this.explore.scene, this.explore.camera);
      this.explore.interactive = id === 'surface';
      next.root.classList.add('visible');
      next.enter(payload);
      bus.emit('screen:entered', { screen: id });
    };
    if (opts.noFade) { doSwap(); return; }
    if (this.transitioning) { doSwap(); return; }
    this.transitioning = true;
    const fade = document.getElementById('fade')!;
    fade.classList.add('show');
    setTimeout(() => {
      doSwap();
      fade.classList.remove('show');
      fade.classList.remove('white');
      this.transitioning = false;
    }, 450);
  }

  update(dt: number): void {
    const t = this.sm.elapsed;
    this.space.update(dt, t);
    this.planet.update(dt, t);
    this.combatScene.update(dt, t);
    this.explore.update(dt, t);
    if (this.current) this.screens.get(this.current)?.update?.(dt, t);
  }

  // ---------------------------------------------------------------- helpers

  save(): void {
    if (this.run && this.run.phase !== 'ended') saveRun(this.run);
    saveMeta(this.meta);
  }

  log(text: string, cls?: 'good' | 'bad' | 'warn'): void {
    bus.emit('log', { text, cls });
  }

  subtitle(text: string, secs = 4.5): void {
    bus.emit('subtitle', { text, secs });
  }

  needRun(): RunState {
    if (!this.run) throw new Error('no active run');
    return this.run;
  }

  // ---------------------------------------------------------------- flow: title / new run

  toTitle(): void {
    this.run = null;
    this.combat = null;
    this.space.enter('title');
    bus.emit('music', { mood: 'title' });
    this.setScreen('title');
  }

  startNewRun(core: string | null): void {
    this.run = newRun(this.meta, core);
    this.save();
    this.space.enter('earth', { upgrades: this.run.upgrades });
    bus.emit('music', { mood: 'intro' });
    this.setScreen('cutscene', {
      key: 'launch',
      then: () => {
        bus.emit('sfx', { name: 'ignite' });
        this.enterGalaxy();
      },
    });
  }

  continueRun(): void {
    const run = loadRun();
    if (!run) { this.toTitle(); return; }
    this.run = run;
    if (run.phase === 'ended' || run.phase === 'dead') { clearRun(); this.toTitle(); return; }
    if (run.pendingReward) {
      this.planet.enter(currentPlanet(run), run.upgrades);
      this.setScreen('reward', run.pendingReward);
    } else if (run.phase === 'galaxy') {
      this.enterGalaxy();
    } else {
      this.enterSurface();
    }
  }

  // ---------------------------------------------------------------- flow: galaxy / jumps

  enterGalaxy(): void {
    const run = this.needRun();
    run.phase = 'galaxy';
    this.save();
    this.space.enter('galaxy', { upgrades: run.upgrades });
    bus.emit('music', { mood: 'map' });
    this.setScreen('galaxy');
  }

  jump(slot: number, free = false): void {
    const run = this.needRun();
    if (!jumpTo(run, slot, { free })) {
      this.log('Insufficient fuel.', 'bad');
      bus.emit('sfx', { name: 'deny' });
      return;
    }
    this.save();
    bus.emit('run:changed');
    bus.emit('sfx', { name: 'warp' });
    // voyage: warp ramp then arrive
    tween(0.9, (k) => { this.space.warpSpeed = k; });
    setTimeout(() => {
      tween(0.6, (k) => { this.space.warpSpeed = 1 - k; });
      this.arrive();
    }, 1100);
  }

  private arrive(): void {
    const run = this.needRun();
    const idx = run.planetIndex;
    // story beats on arrival
    if (idx === 2 && !run.flags['earthGone']) {
      this.space.enter('earthfall', { upgrades: run.upgrades });
      bus.emit('music', { mood: 'grief' });
      this.setScreen('cutscene', {
        key: 'earthfall',
        then: () => this.setScreen('event', { eventId: 'earths_last_broadcast', after: () => this.enterSurface(true) }),
      });
      return;
    }
    if (idx === 11 && !run.flags['sawSibling']) {
      run.flags['sawSibling'] = true;
      bus.emit('music', { mood: 'unease' });
      this.setScreen('cutscene', { key: 'sibling', then: () => this.enterSurface(true) });
      return;
    }
    if (idx === 25) { this.diveEnding(); return; }
    this.enterSurface(true);
  }

  enterSurface(landing = false): void {
    const run = this.needRun();
    run.phase = 'surface';
    this.save();
    bus.emit('music', { mood: 'map' });
    bus.emit('run:changed');
    this.setScreen('surface', { landing });
  }

  // ---------------------------------------------------------------- flow: the explorable surface

  /** Sync the 3D exploration scene with the run's position + reachable beacons. */
  syncExplore(landing = false): void {
    const run = this.needRun();
    const spec = currentPlanet(run);
    const surface = currentSurface(run);
    const cur = surface.nodes[run.nodeId ?? surface.start]!;
    const probeAt = nodeWorldPos(surface, cur, spec.seedKey);
    const pois = this.buildPois(surface, cur, spec.seedKey);
    this.explore.ensure(spec.seedKey, spec.type, run.upgrades, probeAt, pois);
    if (landing) {
      this.explore.interactive = false;
      bus.emit('sfx', { name: 'ignite' });
      this.explore.playLanding(() => {
        this.explore.interactive = this.current === 'surface';
        this.log(`Touchdown. ${spec.name}.`, 'good');
      });
    }
  }

  private buildPois(surface: SurfaceMap, cur: SurfaceNode, seedKey: string): Poi[] {
    const run = this.needRun();
    const sc = scannerLevel(run);
    return cur.next.map((id) => {
      const n = surface.nodes[id]!;
      const intel = nodeIntel(n.kind, sc, true);
      let sub: string | undefined;
      if (sc >= 3 && (n.kind === 'combat' || n.kind === 'elite' || n.kind === 'boss')) {
        const saved = run.nodeId;
        run.nodeId = n.id;
        try {
          const enemies = buildEncounter(run, n.kind === 'boss' ? 'boss' : n.kind);
          sub = [...new Set(enemies.map((e) => getEnemy(e).name.split(',')[0]))].join(' + ');
        } catch { sub = undefined; }
        run.nodeId = saved;
      }
      const pos = nodeWorldPos(surface, n, seedKey);
      return { id, kind: n.kind, glyph: intel.glyph, label: intel.label, sub, color: intel.color, x: pos.x, z: pos.z };
    });
  }

  selectNode(nodeId: string): void {
    const run = this.needRun();
    if (this.traveling) return;
    const surface = currentSurface(run);
    const cur = run.nodeId ? surface.nodes[run.nodeId] : null;
    if (!cur || !cur.next.includes(nodeId)) return;
    this.traveling = true;
    this.explore.interactive = false;
    bus.emit('sfx', { name: 'tick' });
    this.explore.driveTo(nodeId, () => {
      this.traveling = false;
      run.nodeId = nodeId;
      run.visited.push(nodeId);
      this.save();
      this.resolveNode();
    });
  }

  resolveNode(): void {
    const run = this.needRun();
    const surface = currentSurface(run);
    const node = surface.nodes[run.nodeId!];
    if (!node) return;
    switch (node.kind) {
      case 'combat': this.beginCombat('combat'); break;
      case 'elite': this.beginCombat('elite'); break;
      case 'boss': this.beginCombat('boss'); break;
      case 'event': this.openRolledEvent(); break;
      case 'extraction': this.openExtraction(); break;
      case 'fabricator': run.planetsSinceFabricator = 0; this.setScreen('shop'); break;
      case 'forge':
        noteForgeVisit(run, this.meta.archive.includes('black_box'));
        this.save();
        this.setScreen('forge');
        break;
      case 'departure': this.onDeparture(); break;
      case 'landing': break;
    }
  }

  private onDeparture(): void {
    const run = this.needRun();
    if (run.planetIndex === 10 && !run.flags['edenSeen']) {
      run.flags['edenSeen'] = true;
      this.save();
      bus.emit('music', { mood: 'triumph' });
      this.setScreen('cutscene', { key: 'eden', then: () => this.enterGalaxy() });
      return;
    }
    if (run.planetIndex === 20 && !run.flags['ascensionSeen']) {
      run.flags['ascensionSeen'] = true;
      this.save();
      bus.emit('music', { mood: 'transcend' });
      this.setScreen('cutscene', { key: 'ascension', then: () => this.enterGalaxy() });
      return;
    }
    this.enterGalaxy();
  }

  // ---------------------------------------------------------------- flow: combat

  beginCombat(kind: 'combat' | 'elite' | 'boss', explicitEnemies?: string[], lootMult?: number): void {
    const run = this.needRun();
    const enemies = explicitEnemies ?? buildEncounter(run, kind);
    if (lootMult) run.flags['combatLootMult'] = lootMult;
    const start = (): void => {
      this.combatEnemies = enemies;
      const cfg = buildCombatConfig(run, enemies);
      this.combat = startCombat(cfg);
      applyFlareIfAny(run, this.combat.state);
      this.combatScene.enter(
        `${run.seed}:${run.planetIndex}:${run.regen}:${run.nodeId}`,
        currentPlanet(run).type,
        run.upgrades,
        this.combat.state.enemies.map((e) => ({ id: e.id, enemyId: e.enemyId! })),
      );
      bus.emit('music', { mood: kind === 'boss' ? 'boss' : 'combat' });
      this.setScreen('combat');
    };
    if (enemies.includes('exodus') && !run.flags['mirrorSeen']) {
      run.flags['mirrorSeen'] = true;
      this.setScreen('cutscene', { key: 'mirror', then: start });
      return;
    }
    start();
  }

  /** Called by the combat screen when the event queue has fully played out a win/loss. */
  onCombatEnd(won: boolean): void {
    const run = this.needRun();
    const c = this.combat;
    if (!c) return;
    if (!won) { this.handleDeath(); return; }

    const res = combatResources(c);
    const reward = afterCombatWin(run, {
      hull: c.state.player.hp,
      minerals: res.minerals, fuel: res.fuel, data: res.data,
      autoRepair: (c.state.player.flags['autoRepair'] as number) ?? 0,
      chronalUsed: !!c.state.player.flags['chronalUsed'],
      kills: this.combatEnemies.length,
    }, this.combatEnemies);

    // bosses: deeds + paradox loot for echoes
    for (const id of this.combatEnemies) {
      const def = getEnemy(id);
      addDeed(this.meta, `kill:${id}`);
      if (def.tier === 'boss') recordBossKill(this.meta, id);
    }
    if (this.combatEnemies.includes('paradox_echo')) {
      const rng = makeRng(`${run.seed}:paradox:${run.nodeId}:${run.regen}`);
      reward.cards = rng.shuffle(['causal_loop', 'future_echo', 'event_horizon', 'probability_collapse', 'time_dilation', 'singularity_shard']).slice(0, 2);
    }
    this.combat = null;
    this.save();
    bus.emit('run:changed');

    if (this.combatEnemies.includes('exodus')) {
      run.pendingReward = null;
      this.victoryOuroboros();
      return;
    }
    this.planet.enter(currentPlanet(run), run.upgrades);
    this.setScreen('reward', reward);
  }

  handleDeath(): void {
    const run = this.needRun();
    this.combat = null;
    const outcome = onDeath(run, this.meta);
    this.save();
    if (outcome.kind === 'wake') {
      const showWake = (): void => this.setScreen('wake');
      if (!run.flags['firstDeathSeen']) {
        run.flags['firstDeathSeen'] = true;
        bus.emit('music', { mood: 'grief' });
        this.setScreen('cutscene', { key: 'firstDeath', then: showWake });
      } else {
        showWake();
      }
    } else {
      clearRun();
      saveMeta(this.meta);
      bus.emit('music', { mood: 'grief' });
      this.space.enter('title');
      this.setScreen('gameover', { dataBanked: outcome.dataBanked });
    }
  }

  // ---------------------------------------------------------------- flow: events

  openRolledEvent(): void {
    const run = this.needRun();
    const a = act(run);
    const type = currentPlanet(run).type;
    const rng = makeRng(`${run.seed}:event:${run.planetIndex}:${run.regen}:${run.nodeId}`);
    // act 3 threshold station gets the fixed story event
    if (currentPlanet(run).act3Index === 0 && !run.usedEvents.includes('last_transmission')) {
      this.setScreen('event', { eventId: 'last_transmission' });
      return;
    }
    const pool = Object.entries(EVENTS).filter(([id, ev]) => {
      const e = ev as EventDef;
      if (e.story) return false;
      if (e.act !== 0 && e.act !== a) return false;
      if (e.once && run.usedEvents.includes(id)) return false;
      if (e.planetTypes && !e.planetTypes.includes(type)) return false;
      if (id === 'your_own_wreck' && !this.meta.lastDeathDeck.length) return false;
      // soft anti-repeat
      if (run.usedEvents.includes(id) && rng.chance(0.75)) return false;
      return true;
    });
    if (!pool.length) { this.openExtraction(); return; }
    const [id] = rng.pick(pool);
    this.setScreen('event', { eventId: id });
  }

  applyEventOutcome(out: EventOutcome, after?: () => void): void {
    const run = this.needRun();
    const rng = makeRng(`${run.seed}:eventout:${run.nodeId}:${run.regen}:${run.usedEvents.length}`);
    if (out.hull) run.probe.hull = Math.max(1, Math.min(run.probe.hullMax, run.probe.hull + out.hull));
    if (out.hullMaxDelta) { run.probe.hullMax += out.hullMaxDelta; run.probe.hull += Math.max(0, out.hullMaxDelta); }
    if (out.minerals) gainMinerals(run, out.minerals);
    if (out.fuel) gainFuel(run, out.fuel);
    if (out.data) gainData(run, out.data);
    if (out.fuelCapDelta) run.resources.fuelMax += out.fuelCapDelta;
    if (out.refillFuel) run.resources.fuel = run.resources.fuelMax;
    if (out.healFull) run.probe.hull = run.probe.hullMax;
    if (out.addCard) addCardToDeck(run, out.addCard);
    if (out.addCurse) addCardToDeck(run, out.addCurse);
    if (out.addRandomCard) {
      const { randomEventCard } = awardHelpers;
      const id = randomEventCard(run, rng, out.addRandomCard);
      if (id) { addCardToDeck(run, id); this.log(`Acquired: ${id}`, 'good'); }
    }
    if (out.addPayload) {
      const ids = ['repair_canister', 'missile', 'emp_charge', 'coolant_flush', 'shield_cell', 'overdrive_module', 'nanite_ampoule'];
      if (run.payloads.length < run.payloadSlots) run.payloads.push(rng.pick(ids));
    }
    if (out.upgrade && !run.upgrades.includes(out.upgrade)) run.upgrades.push(out.upgrade);
    if (out.takeFromLastDeath && this.meta.lastDeathDeck.length) {
      const id = rng.pick(this.meta.lastDeathDeck);
      addCardToDeck(run, id);
      this.log(`Recovered from the wreck: ${id}`, 'good');
    }
    if (out.setFlag) run.flags[out.setFlag] = true;
    if (out.dataGainMult) run.dataGainMult *= out.dataGainMult;
    if (out.nextCombatsEnergy) run.nextCombatsEnergy = { count: 2, bonus: out.nextCombatsEnergy };
    if (out.fabricatorDiscount) run.flags['fabricatorDiscount'] = out.fabricatorDiscount;
    this.save();
    bus.emit('run:changed');
    if (out.startCombat) {
      this.beginCombat('combat', out.startCombat, out.combatLootMult);
      return;
    }
    after?.();
  }

  // ---------------------------------------------------------------- flow: extraction

  openExtraction(): void {
    const run = this.needRun();
    const spec = currentPlanet(run);
    const rng = makeRng(`${run.seed}:extract:${run.planetIndex}:${run.regen}:${run.nodeId}`);
    const drill = run.upgrades.includes('reinforced_drill') ? 1.4 : 1;
    const vent = run.flags['ventBonus'] ? 2 : 1;
    const mBase = Math.floor(rng.int(12, 22) * spec.richness.minerals * drill * vent);
    const fBase = Math.max(1, Math.floor(rng.int(1, 2) * spec.richness.fuel));
    const dBase = Math.max(2, Math.floor(rng.int(4, 8) * spec.richness.data));
    delete run.flags['ventBonus'];

    interface Deposit { label: string; sub: string; apply(): void }
    const deposits: Deposit[] = [
      { label: 'FERROUS SEAM', sub: `+${mBase} Minerals`, apply: () => gainMinerals(run, mBase) },
      { label: 'VOLATILE ICE', sub: `+${fBase} Fuel, +${Math.floor(mBase / 2)} Minerals`, apply: () => { gainFuel(run, fBase); gainMinerals(run, Math.floor(mBase / 2)); } },
    ];
    if (run.upgrades.includes('exotic_sifter') || rng.chance(0.4)) {
      deposits.push({ label: 'STRANGE NODULE', sub: `+${dBase} Data`, apply: () => gainData(run, dBase) });
    }
    const extra: Array<{ label: string; sub: string; apply(): void }> = [];
    if (run.upgrades.includes('mobile_refinery')) {
      extra.push({ label: '', sub: '', apply: () => gainFuel(run, rng.int(1, 2)) });
    }
    const finish = (apply: () => void, riskNote?: string): void => {
      apply();
      for (const e of extra) e.apply();
      if (riskNote) this.log(riskNote, 'warn');
      bus.emit('sfx', { name: 'loot' });
      this.save();
      bus.emit('run:changed');
      this.setScreen('surface', undefined, { noFade: true });
    };

    const { showModal } = modalApi;
    const choices = deposits.map((d) => ({
      label: d.label,
      sub: d.sub,
      fn: () => finish(d.apply),
    }));
    if (run.upgrades.includes('plasma_bore')) {
      const d0 = deposits[0]!;
      choices.push({
        label: 'DEEP BORE (RISK)',
        sub: `70%: double yield (+${mBase * 2} M) · 30%: −8 Hull`,
        fn: () => {
          if (rng.chance(0.7)) finish(() => gainMinerals(run, mBase * 2));
          else finish(() => { d0.apply(); run.probe.hull = Math.max(1, run.probe.hull - 8); }, 'The bore hit a pressure pocket. −8 Hull.');
        },
      });
    }
    showModal({ title: 'EXTRACTION SITE', tag: currentPlanet(run).name, body: 'Survey returns. Choose a deposit to work.', choices });
  }

  // ---------------------------------------------------------------- endings

  diveEnding(): void {
    const run = this.needRun();
    this.space.enter('blackhole', { upgrades: run.upgrades });
    bus.emit('music', { mood: 'transcend' });
    this.setScreen('cutscene', { key: 'ouroboros', then: () => this.victoryOuroboros(true) });
  }

  victoryOuroboros(fromDive = false): void {
    const run = this.needRun();
    if (!fromDive) {
      // EXODUS just fell — fly the dive first
      this.space.enter('blackhole', { upgrades: run.upgrades });
      bus.emit('music', { mood: 'transcend' });
      bus.emit('sfx', { name: 'boom' });
      this.setScreen('cutscene', { key: 'ouroboros', then: () => this.victoryOuroboros(true) });
      return;
    }
    const banked = bankRunData(run, this.meta);
    this.meta.stats.wins++;
    this.meta.stats.bestAct = 3;
    if (!this.meta.endingsSeen.includes('ouroboros')) this.meta.endingsSeen.push('ouroboros');
    addDeed(this.meta, 'ending:ouroboros');
    saveMeta(this.meta);
    clearRun();
    this.run = null;
    this.space.enter('ending');
    this.setScreen('ending', { key: 'ouroboros', banked });
  }

  abandonRun(): void {
    const run = this.run;
    if (!run) return;
    run.backups = [];
    this.handleDeath();
  }
}

/** Deterministic world placement for a surface node (probe & beacon positions). */
export function nodeWorldPos(surface: SurfaceMap, node: SurfaceNode, seedKey: string): { x: number; z: number } {
  const rng = makeRng(`${seedKey}:pos:${node.id}`);
  const rowsInCol = Object.values(surface.nodes).filter((n) => n.col === node.col).length;
  const spacingX = Math.min(44, 200 / Math.max(1, surface.cols - 1));
  const x = (node.col - (surface.cols - 1) / 2) * spacingX + rng.range(-7, 7);
  const z = (node.row - (rowsInCol - 1) / 2) * 52 + rng.range(-9, 9);
  return { x, z };
}

import { showModal } from '@/ui/components/modal';
const modalApi = { showModal };

import type { Rng } from '@/core/rng';
import { cardPool, CARDS, getCard } from '@/content/registry';
import type { CardDef } from '@/combat/combat-types';
const awardHelpers = {
  randomEventCard(run: RunState, rng: Rng, spec: { rarity?: 'common' | 'uncommon' | 'rare'; metaOnly?: boolean }): string | null {
    if (spec.metaOnly) {
      // a taste of locked tech: any META-tier card, owned pack or not
      const pool = Object.keys(CARDS).filter((id) => (getCard(id) as CardDef).source === 'meta');
      return pool.length ? rng.pick(pool) : null;
    }
    const pool = cardPool({ rarity: spec.rarity, unlockedMeta: run.archiveUnlocks });
    return pool.length ? rng.pick(pool) : null;
  },
};
