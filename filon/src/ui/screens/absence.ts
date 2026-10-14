// absence.ts — « Pendant ton absence »: what the base did while the player was away, laid out
// like a page of the intro's comic (plan §7). CrierBelt signs the header (« vous », lore.md); the
// panels (report-panels.ts, shared with « Avant de partir ») say, in the UI's voice, what the
// Heart gained and lost, what the base made, what went through the Crier and what happened when.
// An approximate catch-up says how far off it may be (`clampedMu`). When this version of the game
// had to adapt the save (sim/save-remap.ts, D47), a last panel says what. Built once when it
// opens (a report does not change); « Reprendre » closes it.
import { el } from '@/core/dom';
import { t } from '@/i18n/i18n';
import { duration } from '@/i18n/format';
import { TICK_MS } from '@/sim/constants';
import type { AwayReport } from '@/sim/offline/report';
import type { RemapNote } from '@/sim/save-remap';
import type { Sim } from '@/sim/state';
import { approxNote, changesPanel, reportPanels } from './report-panels';

export interface AbsenceHost {
  report(): AwayReport | null;
  /** What a load had to change in the save (null: nothing). */
  changes(): RemapNote | null;
  sim(): Sim;
  close(): void;
  /** Closed (« Reprendre », ✕ or Esc): the report has been read. */
  read(): void;
}

export class AbsenceScreen {
  readonly root = el('section.screen.absence', { 'data-screen': 'absence' });

  constructor(private readonly host: AbsenceHost) {}

  refresh(): void { /* a report does not change while it is read */ }

  closed(): void { this.host.read(); }

  opened(): void {
    this.root.replaceChildren(...this.build());
    this.root.querySelector<HTMLButtonElement>('[data-absence-ok]')?.focus();
  }

  private build(): HTMLElement[] {
    const r = this.host.report();
    const changes = this.host.changes();
    const sim = this.host.sim();
    const away = r ? duration(((r.toTick - r.fromTick) * TICK_MS) / 1000) : '';
    const name = sim.colonyName;
    const head = el('header.ab-head.cartouche', {}, [
      el('p.ab-from.lettering', {}, t('away.from')),
      el('h2.lettering', {}, t('screen.absence')),
      r ? el('p.ab-lead', {}, name ? t('away.lead', { name, d: away }) : t('away.lead.unnamed', { d: away })) : null,
      el('button.btn.rs-close', { onclick: () => this.host.close(), title: t('screen.close') }, '✕'),
    ]);
    const panels: HTMLElement[] = r ? reportPanels(r, sim) : [];
    if (changes) panels.push(changesPanel(changes));
    const foot: Array<HTMLElement | null> = [
      r ? approxNote(r) : null,
      el('button.btn.primary.ab-ok', { type: 'button', 'data-absence-ok': '', onclick: () => this.host.close() }, t('away.ok')),
    ];
    return [el('div.ab-page', {}, [head, el('div.ab-panels', {}, panels), el('footer.ab-foot', {}, foot)])];
  }
}
