// debug.ts — window.RP dev console: jump anywhere, force fights, grant anything.
import type { Game } from './game';
import { wipeAll, clearRun } from './core/save';
import { addCardToDeck, currentSurface, gainMinerals, gainData, gainFuel } from './core/run';
import { replicate } from './core/lineage';
import { bus } from './core/bus';

export function installDebug(game: Game): void {
  const RP = {
    game,
    run: () => game.run,
    meta: () => game.meta,
    // economy
    minerals(n = 100) { if (game.run) { gainMinerals(game.run, n); bus.emit('run:changed'); } },
    data(n = 100) { if (game.run) { gainData(game.run, n); bus.emit('run:changed'); } },
    fuel(n = 10) { if (game.run) { gainFuel(game.run, n); bus.emit('run:changed'); } },
    metaData(n = 100) { game.meta.data += n; game.save(); },
    heal() { if (game.run) { game.run.probe.hull = game.run.probe.hullMax; bus.emit('run:changed'); } },
    // deck
    card(id: string, refitted = false) {
      if (game.run) {
        addCardToDeck(game.run, id);
        if (refitted) game.run.deck[game.run.deck.length - 1]!.refitted = true;
        bus.emit('run:changed');
      }
    },
    upgrade(id: string) { if (game.run && !game.run.upgrades.includes(id)) { game.run.upgrades.push(id); bus.emit('run:changed'); } },
    // movement
    fastRun() {
      game.startNewRun(null);
    },
    skipTo(planetIndex: number) {
      const run = game.run;
      if (!run) return;
      run.planetIndex = planetIndex - 1;
      run.resources.fuel = run.resources.fuelMax;
      game.jump(0, true);
    },
    node(kind: string) {
      const run = game.run;
      if (!run) return;
      const surface = currentSurface(run);
      const target = Object.values(surface.nodes).find((n) => n.kind === kind);
      if (target) {
        run.nodeId = target.id;
        run.visited.push(target.id);
        game.resolveNode();
      }
    },
    reachable(): string[] {
      const run = game.run;
      if (!run) return [];
      const surface = currentSurface(run);
      const cur = surface.nodes[run.nodeId ?? surface.start];
      return cur ? [...cur.next] : [];
    },
    go(nodeId?: string) {
      const ids = this.reachable();
      const id = nodeId ?? ids[0];
      if (id) game.selectNode(id);
    },
    combat(...enemies: string[]) {
      game.beginCombat('combat', enemies.length ? enemies : undefined);
    },
    boss() { game.beginCombat('boss'); },
    winCombat() {
      const c = game.combat;
      if (!c) return;
      for (const e of c.state.enemies) e.hp = 0;
      c.state.phase = 'won';
      c.state.events.push({ t: 'win' });
      game.onCombatEnd(true);
    },
    die() {
      const c = game.combat;
      if (c) { c.state.player.hp = 0; c.state.phase = 'lost'; }
      game.handleDeath();
    },
    backup() { if (game.run) { gainMinerals(game.run, 500); replicate(game.run); bus.emit('run:changed'); } },
    ending() { if (game.run) game.victoryOuroboros(); },
    unlockActs() {
      if (!game.meta.deeds.includes('boss:seraph0')) game.meta.deeds.push('boss:seraph0');
      if (!game.meta.deeds.includes('boss:prime')) game.meta.deeds.push('boss:prime');
      game.save();
    },
    clearRun() { clearRun(); location.reload(); },
    wipe() { wipeAll(); location.reload(); },
  };
  (window as unknown as { RP: typeof RP }).RP = RP;
}
