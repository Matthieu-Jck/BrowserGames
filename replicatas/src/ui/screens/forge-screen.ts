// forge-screen.ts — the Replication Forge: repair / refit / replicate / purge.
// Choose exactly one; the node is consumed.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { currentPlanet, replicationCost, totalBurden, refitCard, removeCardFromDeck } from '@/core/run';
import { canReplicate, replicate } from '@/core/lineage';
import { getCard } from '@/content/registry';
import { cardPicker } from '../components/modal';
import { bus } from '@/core/bus';
import { BAL } from '@/core/balance';

export function createForgeScreen(game: Game): Screen {
  const root = el('section');
  const panel = el('div.center-panel.panel');
  root.appendChild(panel);

  function leave(): void {
    game.save();
    bus.emit('run:changed');
    game.setScreen('surface', undefined, { noFade: true });
  }

  function render(): void {
    const run = game.run;
    if (!run) return;
    clear(panel);
    const cost = replicationCost(run);
    const repairAmt = Math.floor(run.probe.hullMax * BAL.forgeRepairFrac);
    const maxBackups = run.upgrades.includes('distributed_lineage') ? 2 : 1;
    const hasReplicationTech = run.upgrades.some((id) => ['assembly_swarm', 'lineage_archive', 'hardened_genome', 'distributed_lineage', 'perfect_copy'].includes(id));

    const backupLine = run.backups.length
      ? run.backups.map((b) => `<span class="c-green">◉ ${b.name}</span> cached at planet ${b.planetIndex}`).join('<br>')
      : '<span class="c-red">NO BACKUP CACHED — if this probe dies, the lineage ends.</span>';

    const rows = el('div', { style: 'padding: 0 18px 16px' });
    rows.appendChild(option('REPAIR', `Restore ${repairAmt} Hull (${run.probe.hull}/${run.probe.hullMax}).`, run.probe.hull < run.probe.hullMax, () => {
      run.probe.hull = Math.min(run.probe.hullMax, run.probe.hull + repairAmt);
      bus.emit('sfx', { name: 'forge' });
      leave();
    }));
    rows.appendChild(option('REFIT', 'Upgrade 1 card in your deck.', run.deck.some((c) => !c.refitted && getCard(c.cardId).refit), () => {
      cardPicker({
        title: 'REFIT A SCHEMATIC',
        cards: run.deck.filter((c) => !c.refitted && getCard(c.cardId).refit),
        count: 1,
        onDone: (uids) => {
          if (uids.length) { refitCard(run, uids[0]!); bus.emit('sfx', { name: 'forge' }); leave(); }
          else render();
        },
      });
    }));
    rows.appendChild(option(
      `REPLICATE — ${cost} M`,
      `Forge a backup of this exact probe (deck, systems, ${run.upgrades.includes('perfect_copy') ? '100%' : run.upgrades.includes('lineage_archive') ? '75%' : '50%'} of resources). `
      + `Burden ${totalBurden(run)} raises the price. Capacity ${run.backups.length}/${maxBackups}${run.backups.length >= maxBackups ? ' — oldest is overwritten' : ''}.`,
      canReplicate(run),
      () => {
        if (replicate(run)) {
          bus.emit('sfx', { name: 'forge' });
          game.log('THE LINEAGE THICKENS. Backup forged.', 'good');
          leave();
        }
      },
    ));
    if (hasReplicationTech) {
      rows.appendChild(option('PURGE', 'Remove 1 card from your deck.', run.deck.length > 5, () => {
        cardPicker({
          title: 'PURGE A SCHEMATIC', cards: run.deck, count: 1,
          onDone: (uids) => {
            if (uids.length) { removeCardFromDeck(run, uids[0]!); bus.emit('sfx', { name: 'forge' }); leave(); }
            else render();
          },
        });
      }));
    }

    panel.append(
      el('div.ptitle', {}, [el('span', {}, 'REPLICATION FORGE'), el('span.tag', {}, currentPlanet(run).name)]),
      el('div.cp-body', { html: `The forge spins up, tasting your alloy. Choose one operation.<br><br>${backupLine}` }),
      rows,
      el('div.cp-actions', {}, [el('button.ghost', { onclick: leave }, 'LEAVE COLD')]),
    );
  }

  function option(label: string, sub: string, enabled: boolean, fn: () => void): HTMLElement {
    const row = el('div.option-row', { cls: enabled ? '' : 'disabled' }, [
      el('div', {}, [el('div.o-label', {}, label), el('div.o-sub', {}, sub)]),
    ]);
    if (enabled) row.addEventListener('click', fn);
    return row;
  }

  return { root, enter: () => render() };
}
