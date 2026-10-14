// hud.ts — persistent top bar + log + subtitle + damage floaters.
import { el, clear, qs } from './dom';
import { bus } from '@/core/bus';
import type { Game } from '@/game';
import { scannerLevel, currentPlanet, replicationCost, removalCost, removeCardFromDeck } from '@/core/run';
import { cardPicker, showModal } from './components/modal';
import { cardEl } from './components/card-el';

export function initHud(game: Game): void {
  const hud = el('div', { id: 'hud' }, [
    el('div.hud-cell', {}, [el('span', { id: 'hud-name' }, '—'), el('span.hud-label', { id: 'hud-gen' }, '')]),
    el('div.hud-cell', {}, [
      el('span.hud-label', {}, 'HULL'),
      el('div.bar', { id: 'bar-hull' }, [el('div.fill')]),
      el('span.hud-num', { id: 'num-hull' }, ''),
    ]),
    el('div.hud-cell', {}, [el('span.hud-label', {}, 'MINERALS'), el('span.hud-num.c-amber', { id: 'num-minerals' }, '')]),
    el('div.hud-cell', {}, [
      el('span.hud-label', {}, 'FUEL'),
      el('div.bar', { id: 'bar-fuel' }, [el('div.fill', { style: 'background: var(--amber)' })]),
      el('span.hud-num', { id: 'num-fuel' }, ''),
    ]),
    el('div.hud-cell', {}, [el('span.hud-label', {}, 'DATA'), el('span.hud-num.c-cyan', { id: 'num-data' }, '')]),
    el('div.hud-cell', {}, [el('span.hud-label', {}, 'SCANNER'), el('span.hud-num', { id: 'num-scanner' }, '')]),
    el('div.hud-cell', {}, [el('span.hud-label', { id: 'hud-loc' }, '')]),
    el('div', { id: 'hud-right' }, [
      el('button.ghost', { id: 'btn-deck', onclick: () => openDeckViewer(game) }, 'DECK'),
      el('button.ghost', { id: 'btn-systems', onclick: () => openSystems(game) }, 'SYSTEMS'),
      el('button.ghost', {
        id: 'btn-abandon',
        onclick: () => confirmAbandon(game),
      }, 'GO DARK'),
    ]),
  ]);
  qs('#ui').appendChild(hud);

  const log = el('div', { id: 'log' });
  document.body.appendChild(log);

  bus.on('log', ({ text, cls }) => {
    const line = el('div.line', { cls: cls ?? '' }, text);
    log.prepend(line);
    while (log.children.length > 14) log.removeChild(log.lastChild!);
  });

  let subTimer: number | null = null;
  bus.on('subtitle', ({ text, secs }) => {
    const sub = qs('#subtitle');
    sub.textContent = text;
    sub.classList.add('show');
    if (subTimer) clearTimeout(subTimer);
    subTimer = window.setTimeout(() => sub.classList.remove('show'), (secs ?? 4.5) * 1000);
  });

  bus.on('run:changed', () => renderHud(game));
  bus.on('screen:entered', ({ screen }) => {
    hud.classList.toggle('visible', !!game.run && !['title', 'cutscene', 'gameover', 'ending'].includes(screen));
    renderHud(game);
  });
}

function renderHud(game: Game): void {
  const run = game.run;
  if (!run) return;
  qs('#hud-name').textContent = run.probe.name;
  qs('#hud-gen').textContent = `GEN ${run.probe.generation}`;
  const hullFill = qs<HTMLElement>('#bar-hull .fill');
  const frac = run.probe.hull / run.probe.hullMax;
  hullFill.style.width = `${Math.max(0, frac * 100)}%`;
  qs('#bar-hull').classList.toggle('low', frac < 0.35);
  qs('#num-hull').textContent = `${run.probe.hull}/${run.probe.hullMax}`;
  qs('#num-minerals').textContent = String(run.resources.minerals);
  qs<HTMLElement>('#bar-fuel .fill').style.width = `${(run.resources.fuel / run.resources.fuelMax) * 100}%`;
  qs('#num-fuel').textContent = `${run.resources.fuel}/${run.resources.fuelMax}`;
  qs('#num-data').textContent = String(run.resources.data);
  qs('#num-scanner').textContent = `LV${scannerLevel(run)}`;
  try {
    qs('#hud-loc').textContent = run.planetIndex > 0
      ? `PLANET ${run.planetIndex} · ${currentPlanet(run).name}`
      : 'SOL DEPARTURE';
  } catch { qs('#hud-loc').textContent = ''; }
}

function openDeckViewer(game: Game): void {
  const run = game.run;
  if (!run) return;
  const freeRemovals = (run.flags['pendingFreeRemovals'] as number) ?? 0;
  if (freeRemovals > 0) {
    cardPicker({
      title: `CLEANER GENOME — REMOVE UP TO ${freeRemovals}`,
      cards: run.deck, count: freeRemovals,
      onDone: (uids) => {
        for (const uid of uids) removeCardFromDeck(run, uid);
        run.flags['pendingFreeRemovals'] = 0;
        game.save();
        bus.emit('run:changed');
      },
    });
    return;
  }
  const grid = el('div.card-grid');
  for (const inst of run.deck) grid.appendChild(cardEl(inst));
  showModal({
    title: `DECK — ${run.deck.length} CARDS`,
    tag: `burden ${replicationCost(run)} M to replicate`,
    content: grid,
    choices: [{ label: 'CLOSE', fn: () => { /* closed */ } }],
  });
}

function openSystems(game: Game): void {
  const run = game.run;
  if (!run) return;
  const { UPGRADES } = upgradesApi;
  const rows = run.upgrades.map((id) => {
    const u = (UPGRADES as Record<string, { name: string; desc: string; burden: number }>)[id];
    return u ? `<div style="margin:6px 0"><span class="c-cyan">${u.name}</span> <span class="c-dim">(burden ${u.burden})</span><br><span class="c-dim">${u.desc}</span></div>` : '';
  }).join('');
  const muts = run.mutations.length ? `<div class="shop-section">MUTATIONS</div>${run.mutations.join(', ')}` : '';
  const backups = run.backups.length
    ? run.backups.map((b) => `<div class="c-green">◉ ${b.name} — cached at planet ${b.planetIndex}</div>`).join('')
    : '<span class="c-red">NO BACKUP — death ends the lineage.</span>';
  showModal({
    title: 'PROBE SYSTEMS',
    tag: `removal ${removalCost(run)} M at fabricators`,
    body: `${rows || '<span class="c-dim">No upgrades installed.</span>'}${muts}<div class="shop-section">LINEAGE</div>${backups}`,
    choices: [{ label: 'CLOSE', fn: () => { /* closed */ } }],
  });
}

function confirmAbandon(game: Game): void {
  if (!game.run || !['surface', 'galaxy'].includes(game.run.phase)) return;
  showModal({
    title: 'DECLARE THIS LINEAGE LOST',
    tag: 'IRREVERSIBLE',
    body: 'Power down, compress memories, transmit everything home — to a home that is not there. The run ends; Data is banked to the Archive.',
    choices: [
      { label: 'GO DARK', cls: 'danger', fn: () => game.abandonRun() },
      { label: 'CANCEL', cls: 'ghost', fn: () => { /* cancelled */ } },
    ],
  });
}

import { UPGRADES } from '@/content/registry';
const upgradesApi = { UPGRADES };

export { renderHud };
export function clearLog(): void {
  const log = document.getElementById('log');
  if (log) clear(log);
}
