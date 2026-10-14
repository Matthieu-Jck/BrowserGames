// wake-screen.ts — death with a backup: choose which replica wakes, then a Mutation.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { wakeFromBackup, applyMutation, mutationOffer, mutationsToOffer, deathRng } from '@/core/lineage';
import { MUTATIONS } from '@/content/registry';
import type { MutationDef } from '@/content/unlocks';
import { bus } from '@/core/bus';

export function createWakeScreen(game: Game): Screen {
  const root = el('section');
  const panel = el('div.center-panel.panel');
  root.appendChild(panel);

  function render(): void {
    const run = game.run;
    if (!run) return;
    clear(panel);
    const rows = run.backups.map((b, i) => {
      const row = el('div.backup-card', {}, [
        el('div.b-name', {}, `◉ ${b.name}`),
        el('div.b-sub', {}, `cached at planet ${b.planetIndex} · ${b.deck.length} cards · ${b.upgrades.length} systems · ${b.minerals} M · ${b.fuel} F`),
      ]);
      row.addEventListener('click', () => {
        wakeFromBackup(run, game.meta, i);
        game.save();
        bus.emit('run:changed');
        offerMutations();
      });
      return row;
    });
    panel.append(
      el('div.ptitle', {}, [el('span', { style: 'color: var(--red)' }, 'SIGNAL LOST'), el('span.tag', {}, 'the lineage continues')]),
      el('div.cp-body', { html:
        'Somewhere behind you, a backup opens its eyes with your memories and a telemetry report that ends mid-sentence.<br><br>'
        + '<em>The road ahead has shifted — nothing past the wake point is as it was.</em>' }),
      el('div', { style: 'padding: 0 18px 16px' }, rows),
    );
  }

  function offerMutations(): void {
    const run = game.run;
    if (!run) return;
    const rng = deathRng(run);
    let picksLeft = mutationsToOffer(run);

    const showOffer = (): void => {
      clear(panel);
      const offer = mutationOffer(run, rng);
      const rows = offer.map((id) => {
        const m = (MUTATIONS as Record<string, MutationDef>)[id]!;
        const row = el('div.option-row', {}, [
          el('div', {}, [el('div.o-label', {}, m.name), el('div.o-sub', {}, m.desc)]),
        ]);
        row.addEventListener('click', () => {
          const note = applyMutation(run, id, rng);
          game.log(`MUTATION: ${m.name} — ${note}`, 'good');
          bus.emit('sfx', { name: 'chime' });
          game.save();
          bus.emit('run:changed');
          picksLeft--;
          if (picksLeft > 0) showOffer();
          else game.enterSurface();
        });
        return row;
      });
      panel.append(
        el('div.ptitle', {}, [el('span', {}, 'WAKE CYCLE — CHOOSE A MUTATION'), el('span.tag', {}, `gen ${run.probe.generation} · slightly improved`)]),
        el('div.cp-body', { html: 'Each generation drifts. Choose how this one differs.' }),
        el('div', { style: 'padding: 0 18px 16px' }, rows),
      );
    };
    showOffer();
  }

  return { root, enter: () => render() };
}
