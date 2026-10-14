// report-card.ts — the finale. A blunt, per-law summary of how well the player read the
// market, an overall grade, and a closing line keyed to that grade.
import { el } from '@/core/dom';
import type { ChapterDef } from '@/journey/types';
import { getProgress } from '@/scoring/progress';
import { gradeLetter } from '@/scoring/grade';
import { OUTRO } from '@/content/copy';

const stars = (n: number): string => '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);

export function buildReportCard(
  chapters: ChapterDef[],
  onRestart: () => void,
): HTMLElement {
  const p = getProgress();
  const rows = chapters.map((c) => {
    const s = p.chapters[c.id] ?? 0;
    return el('div.report-row', { 'data-grade': gradeLetter(s) }, [
      el('span.rr-stars', {}, stars(s)),
      el('div.rr-text', {}, [
        el('span.rr-title', {}, `${c.id}. ${c.title}`),
        el('span.rr-law', {}, c.law),
      ]),
      el('span.rr-grade', {}, gradeLetter(s)),
    ]);
  });

  const avg = chapters.reduce((a, c) => a + (p.chapters[c.id] ?? 0), 0) / Math.max(1, chapters.length);
  const letter = gradeLetter(avg);
  const closing = OUTRO.closing[letter] ?? OUTRO.closing['C']!;

  return el('section.panel.report', { 'data-screen': 'report-card' }, [
    el('div.kicker', {}, 'Report card'),
    el('h1.report-title', {}, OUTRO.title),
    el('div.report-overall', {}, [
      el('span.report-letter', { 'data-grade': letter }, letter),
      el('span.report-closing', {}, closing),
    ]),
    el('div.report-rows', {}, rows),
    el('div.actions', {}, [
      el('button.btn.ghost', { 'data-action': 'restart', onclick: onRestart }, 'Wipe progress & replay'),
    ]),
  ]);
}
