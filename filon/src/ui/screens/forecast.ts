// forecast.ts — « Avant de partir »: what the base will do if the player leaves now, a page of
// the main menu (where a player goes before closing the game). The shell runs the very catch-up
// that will pay the absence (sim/offline) on a copy of the base, so the forecast is the engine's
// own answer, not a guess — the Crier's prices and the weather are the world's, functions of the
// world clock. It holds as long as the player changes nothing (and the market stays the NPC one).
// The player picks how long (1 h, 8 h, 24 h, 3 days); the page says what stops first and when,
// the ocelles at the return, then the same panels as « Pendant ton absence » (report-panels.ts).
// Each choice computes once (« La copie tourne… » paints first); nothing runs at the 4 Hz refresh.
import { el, setAttr, setText } from '@/core/dom';
import { t, type MsgKey } from '@/i18n/i18n';
import { credits } from '@/i18n/format';
import type { AwayReport } from '@/sim/offline/report';
import type { Sim } from '@/sim/state';
import { approxNote, firstStop, incidentText, reportPanels, sinceStart } from './report-panels';

export interface ForecastHost {
  /** The catch-up of `hours` run on a copy of the base (null: no base to forecast). */
  run(hours: number): Promise<{ report: AwayReport; sim: Sim } | null>;
  /** Back to the menu's buttons. */
  close(): void;
}

/** The durations offered, in hours. */
export const FORECAST_HOURS: readonly number[] = [1, 8, 24, 72];

export class ForecastPage {
  readonly root: HTMLElement;
  /** The duration shown (hours). */
  hours = 8;
  /** Static labels, re-set on refresh (language). */
  private readonly labels: Array<[HTMLElement, MsgKey]> = [];
  private readonly opts: Array<{ hours: number; node: HTMLButtonElement }>;
  private readonly body = el('div.fc-body', { 'data-forecast-body': '' });
  /** Bumped by each computation: a slower earlier one never overwrites a later choice. */
  private run = 0;

  constructor(private readonly host: ForecastHost) {
    this.opts = FORECAST_HOURS.map((hours) => ({
      hours,
      node: el<'button'>('button.set-opt', { type: 'button', 'data-forecast-hours': String(hours), onclick: () => this.pick(hours) }),
    }));
    this.root = el('section.forecast', { 'data-screen': 'forecast' }, [
      this.label(el('h2.lettering'), 'forecast.title'),
      this.label(el('p.fc-lead'), 'forecast.lead'),
      el('div.set-row.fc-for', {}, [
        this.label(el('span.set-label.lettering'), 'forecast.for'),
        el('div.set-seg', { role: 'group' }, this.opts.map((o) => o.node)),
      ]),
      this.body,
      el('div.set-foot', {}, [
        this.label(el('p.set-note'), 'forecast.note'),
        this.label(el<'button'>('button.btn.set-back', { type: 'button', onclick: () => host.close() }), 'menu.back'),
      ]),
    ]);
    this.refresh();
  }

  private label<E extends HTMLElement>(node: E, key: MsgKey): E {
    this.labels.push([node, key]);
    return node;
  }

  /** The page is shown: forecast the chosen duration from the base as it is now. */
  open(): void {
    this.compute();
  }

  pick(hours: number): void {
    this.hours = hours;
    this.compute();
  }

  private compute(): void {
    const n = ++this.run;
    const hours = this.hours;
    this.body.setAttribute('data-busy', '');
    this.body.replaceChildren(el('p.fc-busy', {}, t('forecast.computing')));
    this.refresh();
    // A timer, not rAF: the page paints its « La copie tourne… » first, even in a hidden tab.
    window.setTimeout(() => {
      void this.host.run(hours).then((out) => {
        if (n !== this.run) return;
        this.body.removeAttribute('data-busy');
        this.body.replaceChildren(...(out ? this.render(out.report, out.sim) : []));
      });
    }, 30);
  }

  private render(r: AwayReport, sim: Sim): HTMLElement[] {
    const stop = firstStop(r);
    // Nothing stops, yet a full store may still turn production away (the log says what).
    const loses = r.lostMu.some((mu) => mu >= 1000);
    const head = el('div.fc-head', {}, [
      stop
        ? el('p.fc-stop', { 'data-tone': 'down', 'data-forecast-stop': stop.kind }, t('forecast.stop', { d: sinceStart(r, stop.tick), what: incidentText(sim, stop) }))
        : el('p.fc-stop', { 'data-tone': loses ? 'warn' : 'up', 'data-forecast-stop': '' }, t(loses ? 'forecast.noStopLoss' : 'forecast.noStop')),
      el('p.fc-credits', {}, t('forecast.credits', {
        v: `${credits(sim.credits)} (${r.creditsDelta >= 0 ? '+' : '−'}${credits(Math.abs(r.creditsDelta))})`,
      })),
    ]);
    return [head, el('div.ab-panels', {}, reportPanels(r, sim)), approxNote(r)].filter((x): x is HTMLElement => !!x);
  }

  /** Change-only writes: labels (language), the chosen duration. */
  refresh(): void {
    for (const [node, key] of this.labels) setText(node, t(key));
    for (const o of this.opts) {
      setText(o.node, o.hours % 24 === 0 && o.hours > 24 ? t('forecast.days', { n: o.hours / 24 }) : t('forecast.hours', { n: o.hours }));
      setAttr(o.node, 'data-on', o.hours === this.hours ? '' : null);
      setAttr(o.node, 'aria-pressed', o.hours === this.hours ? 'true' : 'false');
    }
  }
}
