// galaxy-screen.ts — destination choice: each candidate world shows a live
// preview sphere and FIVE intel slots; locked slots read ??? until the scanner
// is upgraded. Higher scanner levels also reveal more candidates outright.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { destinationCandidates, jumpFuelCost, scannerLevel, act, currentPlanet } from '@/core/run';
import { destinationIntel, candidateCount } from '@/map/scanner';
import { planetThumb } from '@/vfx/textures';
import { getEnemy } from '@/content/registry';
import { makeRng } from '@/core/rng';
import { rollEncounter } from '@/map/encounters';
import { showModal } from '../components/modal';
import { bus } from '@/core/bus';
import { BAL } from '@/core/balance';

export function createGalaxyScreen(game: Game): Screen {
  const root = el('section');
  const box = el('div', { id: 'galaxy-box' });
  root.appendChild(box);

  function render(): void {
    const run = game.run;
    if (!run) return;
    clear(box);
    const next = run.planetIndex + 1;
    const sc = scannerLevel(run);
    const specs = destinationCandidates(run);

    const head = next === 10 ? 'FINAL APPROACH — THE GARDEN WORLD'
      : next === 20 ? 'FINAL APPROACH — THE FOUNDRY WORLD'
      : next > 20 ? `THE BLACK HOLE APPROACH — ${specs[0]?.name ?? ''}`.toUpperCase()
      : `SELECT DESTINATION — PLANET ${next} OF ${act(run) === 1 ? 10 : 20}`;

    const cards = el('div', { id: 'galaxy-cards' });
    specs.forEach((spec, slot) => {
      let inhabitants: string[] = [];
      if (sc >= 3) {
        const rng = makeRng(spec.seedKey + ':peek');
        const enc = rollEncounter(next > 20 ? 3 : next > 10 ? 2 : 1, spec.type, 'combat', rng, next);
        inhabitants = [...new Set(enc.enemies.map((e) => getEnemy(e).name.split(',')[0] as string))];
      }
      const intel = destinationIntel(spec, sc, inhabitants);
      const cost = jumpFuelCost(run, spec);
      const afford = run.resources.fuel >= cost;

      const rows = intel.rows.map((row) => el('div.d-row', {}, [
        el('span.lbl', {}, row.label),
        row.value != null
          ? el('span', { cls: row.accent === 'bad' ? 'c-red' : row.accent === 'warn' ? 'c-amber' : row.accent === 'good' ? 'c-green' : '', style: 'text-align:right; max-width: 150px' }, row.value)
          : el('span.d-locked', { 'data-tip': `<b>SCANNER LV${row.needsLevel} REQUIRED</b><br>Upgrade the scanner array to resolve this reading.` }, '???'),
      ]));

      const card = el('div.dest-card.panel', {}, [
        el('div.d-top', {}, [
          el('img.d-thumb', { src: planetThumb(spec.seedKey, spec.type), draggable: 'false' }),
          el('div', {}, [
            el('div.d-name', {}, intel.name),
            el('div.d-fuel', {}, [
              el('span.lbl', {}, 'BURN COST '),
              el('span.c-amber', {}, cost === 0 ? 'FREE — falling' : '▮'.repeat(cost) + ` ${cost} fuel`),
            ]),
          ]),
        ]),
        el('div.d-rows', {}, rows),
        el('button', { disabled: !afford, onclick: () => game.jump(slot) }, afford ? 'BURN FOR IT' : 'NO FUEL'),
      ]);
      cards.appendChild(card);
    });

    // hidden candidates teaser: better scanners see more of the sky
    const maxCands = next === 10 || next === 20 || next > 20 ? specs.length : 4;
    for (let i = specs.length; i < maxCands; i++) {
      const needed = i === 2 ? 2 : 4;
      cards.appendChild(el('div.dest-card.panel.d-hidden', {}, [
        el('div.d-unknown-orb', {}, '?'),
        el('div.d-name.c-dim', {}, 'UNRESOLVED CONTACT'),
        el('div.d-desc', {}, `A faint return on the long-range array. SCANNER LV${needed} would resolve another destination.`),
      ]));
    }

    const extra = el('div', { id: 'galaxy-extra' });
    if (run.upgrades.includes('fusion_torch') && !run.freeJumpUsed && next !== 10 && next !== 20 && next <= 20) {
      extra.appendChild(el('button.warn', {
        onclick: () => {
          run.freeJumpUsed = true;
          game.jump(0, true);
        },
      }, 'FUSION TORCH — FREE JUMP (1/act)'));
    }
    if (sc >= 4 && !run.rerollUsed && next !== 10 && next !== 20 && next <= 20) {
      extra.appendChild(el('button.ghost', {
        onclick: () => {
          run.rerollUsed = true;
          run.flags['rerollOffset'] = ((run.flags['rerollOffset'] as number) ?? 0) + 1;
          game.save();
          bus.emit('sfx', { name: 'tick' });
          render();
        },
      }, 'QUANTUM TELESCOPE — RESCAN THE SKY'));
    }

    const cheapest = Math.min(...specs.map((s) => jumpFuelCost(run, s)));
    if (run.resources.fuel < cheapest) {
      extra.appendChild(el('button.danger', { onclick: () => fumes(cheapest, specs.findIndex((s) => jumpFuelCost(run, s) === cheapest)) },
        '⚠ INSUFFICIENT FUEL — OPTIONS'));
    }

    box.append(
      el('div', { id: 'galaxy-head' }, head),
      el('div', { id: 'galaxy-sub' }, [
        el('span.c-cyan', {}, `SCANNER ARRAY LV${sc}`),
        el('span', {}, ` · ${candidateCount(sc)} of 4 contacts resolved · `),
        el('span', {}, run.planetIndex > 0 ? `departing ${currentPlanet(run).name}` : 'departing Sol. There is no going back.'),
      ]),
      cards,
      extra,
    );
  }

  function fumes(cheapest: number, slot: number): void {
    const run = game.run!;
    showModal({
      title: 'RUNNING ON FUMES', tag: 'forced measures',
      body: 'The tanks read empty against every plotted burn.',
      choices: [
        {
          label: `CANNIBALIZE — ${BAL.fuelConvertMinerals} M → ${BAL.fuelConvertAmount} FUEL`,
          disabled: run.resources.minerals < BAL.fuelConvertMinerals,
          fn: () => {
            run.resources.minerals -= BAL.fuelConvertMinerals;
            run.resources.fuel = Math.min(run.resources.fuelMax, run.resources.fuel + BAL.fuelConvertAmount);
            game.save();
            bus.emit('run:changed');
            render();
          },
        },
        {
          label: 'COAST IN ON A DEAD STICK — ARRIVE AT −10 HULL',
          fn: () => {
            run.probe.hull = Math.max(1, run.probe.hull - 10);
            run.resources.fuel = cheapest;
            game.save();
            bus.emit('run:changed');
            game.jump(slot);
          },
        },
      ],
    });
  }

  return { root, enter: () => render() };
}
