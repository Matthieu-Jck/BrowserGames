// verdict.ts — the blunt feedback panel. One reusable component so the harsh voice is
// identical in every chapter: an opener keyed to severity, the consequence headline, the
// gap between what the player did and what was true, and a parting jab.
import { el, clear } from '@/core/dom';
import type { VerdictView } from '@/journey/types';
import type { Severity } from '@/core/kinds';
import { VERDICT_TONE, VERDICT_JAB } from '@/content/copy';

export function renderVerdict(host: HTMLElement, view: VerdictView, severity: Severity): void {
  clear(host);
  const tone = VERDICT_TONE[severity];
  host.className = `verdict show tone-${tone.tone}`;
  host.setAttribute('data-severity', severity);
  host.append(
    el('div.verdict-opener', {}, tone.opener),
    el('div.verdict-headline', {}, view.headline),
    el('div.verdict-gap', {}, [
      el('span.vg-you', {}, view.playerLabel),
      el('span.vg-arrow', { html: '&rarr;' }),
      el('span.vg-real', {}, view.optimalLabel),
    ]),
    el('div.verdict-detail', {}, view.detail),
    el('div.verdict-jab', {}, VERDICT_JAB[severity]),
  );
}
