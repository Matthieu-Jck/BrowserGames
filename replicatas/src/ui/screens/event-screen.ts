// event-screen.ts — narrative events: weighted outcomes + free refit/removal/
// duplicate/transform pickers.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { EVENTS, type EventDef, type EventChoice, type EventOutcome } from '@/content/events';
import { makeRng } from '@/core/rng';
import { currentPlanet, removeCardFromDeck, refitCard, gainData } from '@/core/run';
import { cardPicker } from '../components/modal';
import { getCard, cardPool } from '@/content/registry';
import { makeInstance } from '@/combat/piles';
import { bus } from '@/core/bus';

interface EventPayload {
  eventId: string;
  after?: () => void;
}

export function createEventScreen(game: Game): Screen {
  const root = el('section');
  const panel = el('div.center-panel.panel');
  root.appendChild(panel);
  let after: (() => void) | undefined;

  function defaultAfter(): void {
    game.setScreen('surface', undefined, { noFade: true });
  }

  function render(eventId: string): void {
    const run = game.run;
    if (!run) return;
    const ev = (EVENTS as Record<string, EventDef>)[eventId];
    if (!ev) { (after ?? defaultAfter)(); return; }
    if (!run.usedEvents.includes(eventId)) run.usedEvents.push(eventId);
    clear(panel);
    panel.append(
      el('div.ptitle', {}, [el('span', {}, ev.name), el('span.tag', {}, currentPlanet(run).name)]),
      el('div.cp-body', { html: ev.text.replace(/\n/g, '<br><br>') }),
      el('div', { style: 'padding: 0 18px 16px' }, ev.choices.map((choice) => renderChoice(eventId, ev, choice))),
    );
  }

  function renderChoice(eventId: string, ev: EventDef, choice: EventChoice): HTMLElement {
    const run = game.run!;
    let blocked: string | null = null;
    if (choice.req) {
      if (choice.req.minerals && run.resources.minerals < choice.req.minerals) blocked = `needs ${choice.req.minerals} M`;
      if (choice.req.data && run.resources.data < choice.req.data) blocked = `needs ${choice.req.data} Data`;
      if (choice.req.upgrade && !run.upgrades.includes(choice.req.upgrade)) blocked = 'missing system';
      if (choice.req.lastDeath && !game.meta.lastDeathDeck.length) blocked = 'no prior wreck';
    }
    if (choice.cost) {
      if (choice.cost.minerals && run.resources.minerals < choice.cost.minerals) blocked = `needs ${choice.cost.minerals} M`;
      if (choice.cost.data && run.resources.data < choice.cost.data) blocked = `needs ${choice.cost.data} Data`;
    }
    const row = el('div.option-row', { cls: blocked ? 'disabled' : '' }, [
      el('div', {}, [
        el('div.o-label', {}, choice.label),
        choice.sub ? el('div.o-sub', {}, choice.sub) : null,
      ]),
      blocked ? el('div.o-cost', {}, blocked) : null,
    ]);
    if (!blocked) {
      row.addEventListener('click', () => {
        bus.emit('sfx', { name: 'confirm' });
        if (choice.cost) {
          if (choice.cost.minerals) run.resources.minerals -= choice.cost.minerals;
          if (choice.cost.data) run.resources.data -= choice.cost.data;
          if (choice.cost.fuel) run.resources.fuel = Math.max(0, run.resources.fuel - choice.cost.fuel);
          if (choice.cost.hull) run.probe.hull = Math.max(1, run.probe.hull - choice.cost.hull);
        }
        const rng = makeRng(`${run.seed}:evroll:${eventId}:${run.nodeId}:${run.regen}`);
        const outcome = rng.weighted(choice.outcomes.map((o) => [o, o.p ?? 1] as const));
        resolveOutcome(outcome);
      });
    }
    return row;
  }

  function resolveOutcome(out: EventOutcome): void {
    const run = game.run!;
    clear(panel);
    panel.append(
      el('div.ptitle', {}, [el('span', {}, 'OUTCOME')]),
      el('div.cp-body', { html: out.text }),
      el('div.cp-actions', {}, [
        el('button', {
          onclick: () => {
            // pickers run before continuing
            const continueFlow = (): void => game.applyEventOutcome(out, after ?? defaultAfter);
            if (out.removeCards) {
              cardPicker({
                title: 'REMOVE CARDS', cards: run.deck, count: out.removeCards,
                onDone: (uids) => { uids.forEach((u) => removeCardFromDeck(run, u)); continueFlow(); },
              });
            } else if (out.refitCards) {
              cardPicker({
                title: 'REFIT CARDS', cards: run.deck.filter((c) => !c.refitted && getCard(c.cardId).refit), count: out.refitCards,
                onDone: (uids) => { uids.forEach((u) => refitCard(run, u)); continueFlow(); },
              });
            } else if (out.duplicateCard) {
              cardPicker({
                title: 'DUPLICATE A CARD', cards: run.deck, count: 1,
                onDone: (uids) => {
                  const src = run.deck.find((c) => c.uid === uids[0]);
                  if (src) run.deck.push(makeInstance(src.cardId, src.refitted));
                  continueFlow();
                },
              });
            } else if (out.transformCard) {
              cardPicker({
                title: 'TRANSFORM A CARD', cards: run.deck, count: 1,
                onDone: (uids) => {
                  const src = run.deck.find((c) => c.uid === uids[0]);
                  if (src) {
                    const def = getCard(src.cardId);
                    const rng2 = makeRng(`${run.seed}:transform:${src.uid}`);
                    const rarity = def.rarity === 'rare' ? 'rare' : def.rarity === 'uncommon' ? 'uncommon' : 'common';
                    const pool = cardPool({ rarity, unlockedMeta: run.archiveUnlocks }).filter((id) => id !== src.cardId);
                    if (pool.length) {
                      removeCardFromDeck(run, src.uid);
                      run.deck.push(makeInstance(rng2.pick(pool)));
                    }
                  }
                  continueFlow();
                },
              });
            } else {
              continueFlow();
            }
          },
        }, 'CONTINUE'),
      ]),
    );
    if (out.data) gainData(run, 0); // data is applied in applyEventOutcome; this keeps HUD honest
    bus.emit('run:changed');
  }

  return {
    root,
    enter(payload) {
      const p = payload as EventPayload;
      after = p.after;
      render(p.eventId);
    },
  };
}
