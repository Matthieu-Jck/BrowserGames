// reward-screen.ts — post-combat spoils, clearly split in two prize tracks:
// COMBAT SCHEMATICS (cards for the deck) and PROBE SYSTEMS (upgrades, +Burden).
// Normals yield one track; elites and bosses yield both.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import type { RewardBundle } from '@/core/run';
import { addCardToDeck, replicationCost } from '@/core/run';
import { cardElById } from '../components/card-el';
import { getCard, getUpgrade } from '@/content/registry';
import { keywordize } from '../components/tooltip';
import { bus } from '@/core/bus';

export function createRewardScreen(game: Game): Screen {
  const root = el('section');
  const panel = el('div.center-panel.wide.panel');
  root.appendChild(panel);

  let cardClaimed = false;
  let upgradeClaimed = false;

  function done(): void {
    const run = game.run;
    if (run) {
      run.pendingReward = null;
      game.save();
    }
    game.setScreen('surface', undefined, { noFade: true });
  }

  function render(bundle: RewardBundle): void {
    const run = game.run;
    if (!run) return;
    clear(panel);

    const lootLines: string[] = [];
    if (bundle.minerals) lootLines.push(`<span class="c-amber">+${bundle.minerals} Minerals</span>`);
    if (bundle.data) lootLines.push(`<span class="c-cyan">+${bundle.data} Data</span>`);
    if (bundle.cardDrop) {
      const def = getCard(bundle.cardDrop);
      lootLines.push(`<span class="c-violet">SALVAGED FROM THE WRECK: ${def.name}</span> — added to your deck`);
    }
    if (bundle.trophy) {
      const u = getUpgrade(bundle.trophy);
      lootLines.push(`<span class="c-gold">TROPHY: ${u.name}</span> — ${u.desc} <span class="c-dim">(burden +${u.burden})</span>`);
    }

    panel.append(
      el('div.ptitle', {}, [
        el('span', {}, bundle.fromBoss ? 'GUARDIAN NEUTRALIZED' : 'SPOILS'),
        el('span.tag', {}, bundle.cards.length && bundle.upgrades.length ? 'two prize tracks — claim each' : 'claim or skip'),
      ]),
    );
    if (lootLines.length) {
      panel.append(el('div.cp-body', { html: lootLines.map((l) => keywordize(l)).join('<br>') }));
    }

    // ---------------- COMBAT SCHEMATICS (cards)
    if (bundle.cards.length) {
      panel.append(el('div.reward-section.rs-cards', {}, [
        el('span.rs-icon', {}, '🂠'),
        el('span', {}, 'COMBAT SCHEMATIC'),
        el('span.rs-note', {}, cardClaimed ? 'CLAIMED' : 'add one card to your deck'),
      ]));
      const grid = el('div.card-grid', { cls: cardClaimed ? 'claimed' : '' });
      for (const cardId of bundle.cards) {
        const node = cardElById(cardId);
        node.addEventListener('click', () => {
          if (cardClaimed) return;
          cardClaimed = true;
          addCardToDeck(run, cardId);
          bus.emit('sfx', { name: 'loot' });
          game.log(`Fabricated: ${getCard(cardId).name}`, 'good');
          game.save();
          bus.emit('run:changed');
          maybeFinish(bundle);
        });
        grid.appendChild(node);
      }
      panel.append(grid);
    }

    // ---------------- PROBE SYSTEMS (upgrades)
    if (bundle.upgrades.length) {
      panel.append(el('div.reward-section.rs-systems', {}, [
        el('span.rs-icon', {}, '⚙'),
        el('span', {}, 'PROBE SYSTEM'),
        el('span.rs-note', {}, upgradeClaimed ? 'INSTALLED' : `install one — Burden raises replication (now ${replicationCost(run)} M)`),
      ]));
      const rows = el('div', { style: 'padding: 0 18px 8px', cls: upgradeClaimed ? 'claimed' : '' });
      for (const id of bundle.upgrades) {
        const u = getUpgrade(id);
        const row = el('div.option-row.upgrade-row', {}, [
          el('div', {}, [
            el('div.o-label', {}, `⚙ ${u.name}`),
            el('div.o-sub', {}, u.desc),
          ]),
          el('div.o-cost', {}, `burden +${u.burden}`),
        ]);
        row.addEventListener('click', () => {
          if (upgradeClaimed || run.upgrades.includes(id)) return;
          upgradeClaimed = true;
          run.upgrades.push(id);
          bus.emit('sfx', { name: 'forge' });
          game.log(`System installed: ${u.name}`, 'good');
          game.save();
          bus.emit('run:changed');
          maybeFinish(bundle);
        });
        rows.appendChild(row);
      }
      panel.append(rows);
    }

    panel.append(
      el('div.cp-actions', {}, [
        el('button.ghost', { onclick: done }, 'SKIP THE REST — TRAVEL LIGHT'),
      ]),
    );
  }

  function maybeFinish(bundle: RewardBundle): void {
    const cardsDone = !bundle.cards.length || cardClaimed;
    const upgradesDone = !bundle.upgrades.length || upgradeClaimed;
    if (cardsDone && upgradesDone) done();
    else render(bundle);
  }

  return {
    root,
    enter(payload) {
      const run = game.run;
      const bundle = payload as RewardBundle;
      cardClaimed = false;
      upgradeClaimed = false;
      if (run && bundle.cardDrop && !run.flags[`drop_${bundle.cardDrop}_${run.nodeId}`]) {
        run.flags[`drop_${bundle.cardDrop}_${run.nodeId}`] = true;
        addCardToDeck(run, bundle.cardDrop);
      }
      if (run && bundle.trophy && !run.upgrades.includes(bundle.trophy)) {
        run.upgrades.push(bundle.trophy);
      }
      game.save();
      bus.emit('run:changed');
      render(bundle);
    },
  };
}
