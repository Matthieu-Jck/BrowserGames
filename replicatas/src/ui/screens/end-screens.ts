// end-screens.ts — gameover (lineage ends, Data banked) + the endings.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { ENDINGS } from '@/content/story';
import { bus } from '@/core/bus';

export function createGameoverScreen(game: Game): Screen {
  const root = el('section');
  const box = el('div', { id: 'gameover-box' });
  root.appendChild(box);
  return {
    root,
    enter(payload) {
      const p = payload as { dataBanked: number };
      clear(box);
      const m = game.meta;
      clearRunRef(game);
      box.append(
        el('div.ending-title', {}, 'THE LINEAGE ENDS'),
        el('div.ending-text', {}, ENDINGS.silence.text),
        el('div.ending-stats', {}, `DATA BANKED TO THE ARCHIVE: +${p.dataBanked} (total ${m.data}) · the next probe will know what this one learned`),
        el('button', { style: 'margin-top: 30px', onclick: () => { bus.emit('sfx', { name: 'confirm' }); game.toTitle(); } }, 'RETURN TO THE ARCHIVE'),
      );
      if (!m.endingsSeen.includes('silence')) m.endingsSeen.push('silence');
    },
  };
}

export function createEndingScreen(game: Game): Screen {
  const root = el('section');
  const box = el('div', { id: 'ending-box' });
  root.appendChild(box);
  return {
    root,
    enter(payload) {
      const p = payload as { key: keyof typeof ENDINGS; banked: number };
      const e = ENDINGS[p.key] ?? ENDINGS.ouroboros;
      clear(box);
      box.append(
        el('div.ending-title', { style: `color:${e.color}; text-shadow: 0 0 30px ${e.color}66` }, e.title),
        el('div.ending-text', {}, e.text),
        el('div.ending-stats', {}, `DATA BANKED: +${p.banked} · wins ${game.meta.stats.wins} · the loop closes`),
        el('button', { style: 'margin-top: 30px', onclick: () => game.toTitle() }, 'BEGIN AGAIN'),
      );
    },
  };
}

function clearRunRef(game: Game): void {
  game.run = null;
}
