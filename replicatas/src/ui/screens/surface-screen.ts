// surface-screen.ts — thin overlay over the explorable 3D surface: planet
// header, scanner readout, controls hint. Travel happens by clicking beacons
// in the scene itself.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { currentPlanet, currentSurface, scannerLevel } from '@/core/run';
import { PLANET_TYPES } from '@/map/planet-gen';

export function createSurfaceScreen(game: Game): Screen {
  const root = el('section');
  const head = el('div', { id: 'surface-head', cls: 'panel' });
  const hint = el('div', { id: 'surface-hint' }, 'DRAG TO LOOK AROUND · CLICK A BEACON TO TRAVEL');
  root.append(head, hint);

  function render(): void {
    const run = game.run;
    if (!run) return;
    clear(head);
    const spec = currentPlanet(run);
    const surface = currentSurface(run);
    const def = PLANET_TYPES[spec.type];
    const sc = scannerLevel(run);
    const cur = surface.nodes[run.nodeId ?? surface.start]!;
    const ahead = cur.next.length;
    const resolved = sc >= 1;
    head.append(
      el('div.s-name', {}, spec.name),
      el('div.s-sub', {}, `${def.label} · PLANET ${run.planetIndex}`),
      el('div.s-scan', {}, [
        el('span', { cls: 'c-cyan' }, `SCANNER LV${sc}`),
        el('span', { cls: 'c-dim' }, ` — ${ahead} signature${ahead === 1 ? '' : 's'} in range${resolved ? '' : ' (unresolved — upgrade scanner to identify)'}`),
      ]),
    );
  }

  return {
    root,
    enter(payload) {
      const p = (payload ?? {}) as { landing?: boolean };
      render();
      game.syncExplore(!!p.landing);
    },
    exit() {
      game.explore.interactive = false;
    },
  };
}
