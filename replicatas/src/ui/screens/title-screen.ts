// title-screen.ts — title menu, loadout choice, the Archive (meta shop), stats.
import { el, clear } from '../dom';
import type { Game, Screen } from '@/game';
import { loadRun } from '@/core/save';
import { saveMeta } from '@/core/save';
import { ARCHIVE } from '@/content/registry';
import { hasUnlock, act2Unlocked, act3Unlocked } from '@/core/meta';
import { showModal } from '../components/modal';
import { TITLE_TAGLINE } from '@/content/story';
import { bus } from '@/core/bus';

export function createTitleScreen(game: Game): Screen {
  const root = el('section');
  const box = el('div', { id: 'title-box' });
  root.appendChild(box);

  function render(): void {
    clear(box);
    const hasSave = !!loadRun();
    const menu = el('div.title-menu');
    if (hasSave) {
      menu.appendChild(el('button', { onclick: () => { bus.emit('sfx', { name: 'confirm' }); game.continueRun(); } }, 'RESUME TELEMETRY'));
    }
    menu.appendChild(el('button', { onclick: () => { bus.emit('sfx', { name: 'confirm' }); chooseLoadout(); } }, 'INITIALIZE PROBE'));
    menu.appendChild(el('button.ghost', { onclick: () => { bus.emit('sfx', { name: 'tick' }); openArchive(); } }, `THE ARCHIVE — ${game.meta.data} DATA`));

    const m = game.meta;
    const acts = act3Unlocked(m) ? 'ACTS I–III CHARTED' : act2Unlocked(m) ? 'ACTS I–II CHARTED' : 'ACT I CHARTED';
    box.append(
      el('h1.gametitle', { html: 'REPLICATAS<span class="x">_</span>' }),
      el('div.subtitle-line', {}, TITLE_TAGLINE),
      menu,
      el('div', { id: 'title-meta' }, [
        el('div', {}, `${acts} · runs ${m.stats.runs} · wins ${m.stats.wins} · deepest planet ${m.stats.bestPlanet} · generation ${m.generationCounter}`),
      ]),
    );
  }

  function chooseLoadout(): void {
    const m = game.meta;
    const cores = (['core_laser', 'core_kinetic', 'core_nuclear', 'core_speed', 'core_repair'] as const).filter((c) => hasUnlock(m, c));
    if (!cores.length) {
      if (loadRun()) {
        showModal({
          title: 'OVERWRITE TELEMETRY?', tag: 'a run is in progress',
          body: 'Initializing a new probe abandons the saved run (its Data is lost — go dark in-game to bank it).',
          choices: [
            { label: 'LAUNCH NEW PROBE', cls: 'danger', fn: () => game.startNewRun(null) },
            { label: 'CANCEL', cls: 'ghost', fn: () => { /* cancel */ } },
          ],
        });
      } else {
        game.startNewRun(null);
      }
      return;
    }
    showModal({
      title: 'SELECT LOADOUT', tag: 'fabrication cores',
      choices: [
        { label: 'STANDARD PROTOCOL', sub: '5× Pulse Laser, 4× Shield Matrix, System Scan.', fn: () => game.startNewRun(null) },
        ...cores.map((c) => ({
          label: ARCHIVE[c].name.toUpperCase(),
          sub: ARCHIVE[c].desc,
          fn: () => game.startNewRun(c),
        })),
      ],
    });
  }

  function openArchive(): void {
    const m = game.meta;
    const available = Object.entries(ARCHIVE).filter(([id]) => !m.archive.includes(id));
    showModal({
      title: 'THE ARCHIVE', tag: `${m.data} DATA banked`,
      body: available.length
        ? 'Lineage knowledge persists between probes. Spend banked Data on permanent unlocks.'
        : 'Every entry decrypted. The Archive is complete.',
      choices: [
        ...available.slice(0, 9).map(([id, u]) => ({
          label: `${u.name} — ${u.cost} DATA`,
          sub: u.desc,
          disabled: m.data < u.cost,
          fn: () => {
            m.data -= u.cost;
            m.archive.push(id);
            saveMeta(m);
            bus.emit('sfx', { name: 'chime' });
            render();
            openArchive();
          },
        })),
        { label: 'CLOSE', cls: 'ghost', fn: () => render() },
      ],
    });
  }

  return {
    root,
    enter: () => render(),
  };
}
