// sim-events.ts — what the colony reports, turned into feedback. After each frame's ticks the
// app drains `sim.events` through HANDLERS (one per SimEvent kind — the mapped type makes a
// new kind fail to compile until it has a handler): toasts, bus events for the UI, sound cues
// (bus `sfx`: research and quests done, cargo lifts, deliveries, the Gazette, ore found; an item
// named in a toast goes as `itemRef`, so it shows its icon: ui/mention.ts), and view
// invalidation (a structure change rebuilds the building and item views; dug or filled tiles
// repaint their terrain chunks and relief). Land (docs/land.md): a parcel bought, leased or given
// up gets a short notice; a lease that lapsed (the purse could not pay its hour) a warning, since
// what stood on it is dormant now; the hourly rent is silent (the HUD's ocelles show it).
import { RESEARCH, buildingsUnlockedBy, nodeName, type ResearchId } from '@/content/research';
import type { ResearchDef } from '@/content/types';
import { bus } from '@/core/bus';
import { locale, t } from '@/i18n/i18n';
import type { ColonyView } from '@/market/types';
import type { SimEvent } from '@/sim/commands';
import { gazetteToast } from '@/ui/gazette';
import { parcelLabel } from '@/ui/land-facts';
import { oc } from '@/ui/trade-view';
import { itemRef } from '@/ui/mention';
import { questToast } from '@/ui/quest-log';
import type { Toasts } from '@/ui/toasts';

export interface EventSink {
  toasts: Toasts;
  /** Set by handlers: the building / item views must rebuild after the drain. */
  structure: boolean;
  /** The world's sister colonies (Gazette lines name them), and the epoch now. */
  colonies(): readonly ColonyView[];
  epoch: number;
  /** A trade post lifted cargo (the shell launches the drone for a sale and feeds the orbital view). */
  lift(ev: Extract<SimEvent, { k: 'trade' }>): void;
  /** Purchases landed in a post's container (the shell brings the drone down with them, D43). */
  land?(ev: Extract<SimEvent, { k: 'delivered' }>): void;
}

type Handlers = { [K in SimEvent['k']]: (ev: Extract<SimEvent, { k: K }>, sink: EventSink) => void };

const HANDLERS: Handlers = {
  structure: (_ev, sink) => { sink.structure = true; },
  epoch: (ev) => bus.emit('sim:epoch', { epoch: ev.epoch }),
  plan: (ev, sink) => {
    // A plan that unlocks buildings is announced by the build bar (« Nouveau : X », D27); a
    // feature plan (telemetry…) has no slot to show, so it gets its own notice.
    if (!buildingsUnlockedBy(ev.id).length) sink.toasts.show('good', t('tree.toast', { name: nodeName(ev.id)[locale()] }), 5000);
  },
  research: (ev, sink) => {
    if (ev.id.startsWith('respec:')) sink.toasts.show('good', t('toast.respec'), 5000);
    else sink.toasts.show('good', t('toast.research', { name: (RESEARCH[ev.id as ResearchId] as ResearchDef).name[locale()] }), 6000);
    bus.emit('sim:research-done', { id: ev.id });
    bus.emit('sfx', { cue: 'research' });
  },
  dug: (ev, sink) => {
    for (const o of ev.ore) sink.toasts.show('good', t('toast.vein', { n: Math.round(o.mu / 1000), item: itemRef(o.item) }), 4000);
    if (ev.ore.length) bus.emit('sfx', { cue: 'vein' });
  },
  filled: () => { /* the chunk repaint covers it */ },
  trade: (ev, sink) => { sink.lift(ev); bus.emit('sfx', { cue: 'lift' }); },
  delivered: (ev, sink) => {
    sink.land?.(ev);
    sink.toasts.show('good', t('toast.delivered', { n: Math.round(ev.mu / 1000), item: itemRef(ev.item) }), 3500);
    bus.emit('sfx', { cue: 'delivered' });
  },
  gazette: (ev, sink) => {
    for (const e of ev.announced) sink.toasts.show('info', gazetteToast('announced', e, sink.colonies(), sink.epoch), 7000);
    for (const e of ev.started) sink.toasts.show('warn', gazetteToast('started', e, sink.colonies(), sink.epoch), 6000);
    if (ev.announced.length || ev.started.length) bus.emit('sfx', { cue: 'notice' });
  },
  quest: (ev, sink) => { sink.toasts.show('good', questToast(ev.id, ev.title), 7000); bus.emit('sfx', { cue: 'quest' }); },
  land: (ev, sink) => {
    const c = parcelLabel(ev.p);
    switch (ev.what) {
      case 'bought': sink.toasts.show('good', t('toast.land.bought', { c, v: oc(ev.cents) }), 4000); bus.emit('sfx', { cue: 'purchase' }); break;
      case 'leased': sink.toasts.show('good', t('toast.land.leased', { c, v: oc(ev.cents) }), 4000); bus.emit('sfx', { cue: 'purchase' }); break;
      case 'ended': sink.toasts.show('info', t('toast.land.ended', { c }), 4000); break;
      case 'lapsed': sink.toasts.show('bad', t('toast.land.lapsed', { c }), 9000); bus.emit('sfx', { cue: 'notice' }); break;
      case 'rent': break; // every hour: the purse shows it
    }
    // What stands on land newly held wakes, on land let go sleeps: the views follow the graph.
    if (ev.what !== 'rent') sink.structure = true;
  },
};

/** Dispatch and clear the colony's pending events. Returns whether the structure changed. */
export function drainSimEvents(events: SimEvent[], sink0: Omit<EventSink, 'structure'>): boolean {
  if (!events.length) return false;
  const sink: EventSink = { ...sink0, structure: false };
  for (const ev of events) (HANDLERS[ev.k] as (e: SimEvent, s: EventSink) => void)(ev, sink);
  events.length = 0;
  return sink.structure;
}
