// shop-screen.ts — the Fabricator Bay: cards, payloads, upgrades, card removal,
// curse purging, fuel synthesis.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import {
  act, currentPlanet, rollCardRewards, removalCost, removeCardFromDeck,
  addCardToDeck, refitCard, gainFuel,
} from '@/core/run';
import { makeRng } from '@/core/rng';
import { getCard, getUpgrade, UPGRADES, PAYLOADS, getPayload } from '@/content/registry';
import type { UpgradeDef } from '@/content/upgrades';
import { cardElById } from '../components/card-el';
import { cardPicker } from '../components/modal';
import { bus } from '@/core/bus';
import { BAL } from '@/core/balance';

export function createShopScreen(game: Game): Screen {
  const root = el('section');
  const panel = el('div.center-panel.wide.panel');
  root.appendChild(panel);

  function discount(): number {
    const d = game.run?.flags['fabricatorDiscount'];
    return typeof d === 'number' ? 1 - d : 1;
  }

  function price(n: number): number {
    return Math.ceil(n * discount());
  }

  function render(): void {
    const run = game.run;
    if (!run) return;
    clear(panel);
    const rng = makeRng(`${run.seed}:shop:${run.planetIndex}:${run.regen}:${run.nodeId}`);
    const soldKey = `shopSold:${run.planetIndex}:${run.nodeId}`;
    const sold = new Set(((run.flags[soldKey] as string) ?? '').split(',').filter(Boolean));

    // ------------ card stock (stable per node; sold items greyed)
    const cardStock = rollCardRewards(run, rng, 'normal').slice(0, 5);
    const grid = el('div.card-grid');
    for (const id of cardStock) {
      if (sold.has(id)) continue;
      const def = getCard(id);
      const cost = price(BAL.cardCost[def.rarity] ?? 50);
      const node = cardElById(id, { price: cost });
      if (run.resources.minerals < cost) node.classList.add('unplayable-now');
      node.addEventListener('click', () => {
        if (run.resources.minerals < cost) { bus.emit('sfx', { name: 'deny' }); return; }
        run.resources.minerals -= cost;
        addCardToDeck(run, id);
        sold.add(id);
        run.flags[soldKey] = [...sold].join(',');
        bus.emit('sfx', { name: 'loot' });
        game.save();
        bus.emit('run:changed');
        render();
      });
      grid.appendChild(node);
    }

    // ------------ services & upgrades
    const services = el('div', { style: 'padding: 0 18px 14px' });
    services.appendChild(el('div.shop-section', {}, 'SERVICES'));
    const rCost = price(removalCost(run));
    services.appendChild(serviceRow('PURGE A SCHEMATIC', `remove 1 card from your deck — ${rCost} M`, run.resources.minerals >= rCost, () => {
      cardPicker({
        title: 'PURGE A SCHEMATIC', cards: run.deck, count: 1,
        onDone: (uids) => {
          if (uids.length) {
            run.resources.minerals -= rCost;
            run.removalsBought++;
            removeCardFromDeck(run, uids[0]!);
            game.save();
            bus.emit('run:changed');
          }
          render();
        },
      });
    }));
    const refitPrice = price(40);
    services.appendChild(serviceRow('REFIT A SCHEMATIC', `upgrade 1 card — ${refitPrice} M`, run.resources.minerals >= refitPrice, () => {
      cardPicker({
        title: 'REFIT', cards: run.deck.filter((c) => !c.refitted && getCard(c.cardId).refit), count: 1,
        onDone: (uids) => {
          if (uids.length) {
            run.resources.minerals -= refitPrice;
            refitCard(run, uids[0]!);
            game.save();
            bus.emit('run:changed');
          }
          render();
        },
      });
    }));
    if (run.upgrades.includes('fuel_synthesizer')) {
      services.appendChild(serviceRow('SYNTHESIZE FUEL', `${BAL.fuelConvertMinerals} M → ${BAL.fuelConvertAmount} Fuel`,
        run.resources.minerals >= BAL.fuelConvertMinerals && run.resources.fuel < run.resources.fuelMax, () => {
          run.resources.minerals -= BAL.fuelConvertMinerals;
          gainFuel(run, BAL.fuelConvertAmount);
          game.save();
          bus.emit('run:changed');
          render();
        }));
    }

    // payload stock
    services.appendChild(el('div.shop-section', {}, 'PAYLOADS'));
    const payloadIds = rng.shuffle(Object.keys(PAYLOADS)).filter((id) => {
      const p = getPayload(id);
      return !(p.act2Plus && act(run) < 2);
    }).slice(0, 3);
    for (const pid of payloadIds) {
      if (sold.has('p:' + pid)) continue;
      const p = getPayload(pid);
      const cost = price(p.cost);
      const full = run.payloads.length >= run.payloadSlots;
      services.appendChild(serviceRow(p.name.toUpperCase(), `${p.desc} — ${cost} M${full ? ' (racks full)' : ''}`,
        run.resources.minerals >= cost && !full, () => {
          run.resources.minerals -= cost;
          run.payloads.push(pid);
          sold.add('p:' + pid);
          run.flags[soldKey] = [...sold].join(',');
          game.save();
          bus.emit('run:changed');
          render();
        }));
    }

    // upgrade stock
    services.appendChild(el('div.shop-section', {}, 'UPGRADES — every system adds Burden'));
    const upgradeStock = rng.shuffle(Object.keys(UPGRADES)).filter((id) => {
      const u = getUpgrade(id);
      if (u.trophy || u.cost === 0) return false;
      if (run.upgrades.includes(id)) return false;
      if (u.requires && !run.upgrades.includes(u.requires)) return false;
      if (u.act2Plus && act(run) < 2) return false;
      return true;
    }).slice(0, 4);
    for (const id of upgradeStock) {
      const u = getUpgrade(id) as UpgradeDef;
      const cost = price(u.cost);
      services.appendChild(serviceRow(`${u.name.toUpperCase()} — ${cost} M`, `${u.desc} (burden +${u.burden})`,
        run.resources.minerals >= cost, () => {
          run.resources.minerals -= cost;
          run.upgrades.push(id);
          bus.emit('sfx', { name: 'forge' });
          game.save();
          bus.emit('run:changed');
          render();
        }));
    }

    panel.append(
      el('div.ptitle', {}, [el('span', {}, 'FABRICATOR BAY'), el('span.tag', {}, `${currentPlanet(run).name} · ${run.resources.minerals} M`)]),
      grid,
      services,
      el('div.cp-actions', {}, [el('button.warn', { onclick: () => game.setScreen('surface', undefined, { noFade: true }) }, 'LEAVE BAY')]),
    );
  }

  function serviceRow(label: string, sub: string, enabled: boolean, fn: () => void): HTMLElement {
    const row = el('div.option-row', { cls: enabled ? '' : 'disabled' }, [
      el('div', {}, [el('div.o-label', {}, label), el('div.o-sub', {}, sub)]),
    ]);
    if (enabled) row.addEventListener('click', fn);
    return row;
  }

  return { root, enter: () => render() };
}
