// combat-screen.ts — hand fan, click-to-target, enemy intent overlays, and the
// CombatEvent queue playback that keeps UI/3D/audio in sync with the engine.
import { el, svgEl, clear } from '../dom';
import type { Game, Screen } from '@/game';
import {
  playCard, endTurn, canPlay, cardCost, drainEvents, usePayload, scoutResolve,
} from '@/combat/engine';
import { intentPreview } from '@/combat/intents';
import type { CombatEvent, ActorState } from '@/combat/combat-types';
import { effectiveCard, getPayload } from '@/content/registry';
import { STATUSES } from '@/combat/statuses';
import { cardEl } from '../components/card-el';
import { bus } from '@/core/bus';

export function createCombatScreen(game: Game): Screen {
  const root = el('section');
  const handEl = el('div', { id: 'hand' });
  const enemyTags = el('div');
  const targetSvg = svgEl('svg', { id: 'targeting-svg' });
  const arrow = svgEl('path', { stroke: 'var(--amber)', 'stroke-width': '2.5', fill: 'none', 'stroke-dasharray': '7 5' });
  targetSvg.appendChild(arrow);

  const playerPanel = el('div.panel', { id: 'player-panel' });
  const rightPanel = el('div', { id: 'combat-right' });
  const bottom = el('div', { id: 'combat-bottom' }, [playerPanel, rightPanel]);
  root.append(enemyTags, bottom, handEl, targetSvg as unknown as HTMLElement);

  let selectedUid: string | null = null;
  let busy = false;
  let mouse = { x: 0, y: 0 };
  const tagEls = new Map<string, HTMLElement>();

  document.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; });
  document.addEventListener('contextmenu', (e) => {
    if (selectedUid) { e.preventDefault(); deselect(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedUid) deselect();
    if (e.key === 'e' && game.current === 'combat' && !busy) doEndTurn();
  });

  function deselect(): void {
    selectedUid = null;
    arrow.setAttribute('d', '');
    renderHand();
    renderEnemies();
  }

  // ---------------------------------------------------------------- rendering

  function renderAll(): void {
    renderPlayer();
    renderHand();
    renderEnemies();
  }

  function renderPlayer(): void {
    const c = game.combat;
    if (!c) return;
    const p = c.state.player;
    clear(playerPanel);
    const statusChips = el('div', { id: 'player-statuses' });
    for (const [sid, n] of Object.entries(p.statuses)) {
      const def = STATUSES[sid];
      if (!def) continue;
      statusChips.appendChild(el('span.status-chip', { 'data-kw': sid, style: `color:${def.color}` }, `${def.icon}${n}`));
    }
    playerPanel.append(
      el('div.pp-row', {}, [
        el('span', {}, game.run?.probe.name ?? 'PROBE'),
        el('span.c-dim', {}, `turn ${c.state.turn}`),
      ]),
      el('div.pp-row', {}, [
        el('span.hud-label', {}, 'HULL'),
        el('span', { cls: p.hp < p.hpMax * 0.35 ? 'c-red' : 'c-green' }, `${p.hp}/${p.hpMax}`),
        el('span.hud-label', {}, 'SHIELDS'),
        el('span.c-cyan', {}, String(p.block)),
      ]),
      statusChips,
    );

    clear(rightPanel);
    const payloadRow = el('div', { id: 'payload-row' });
    for (const [i, pid] of (game.run?.payloads ?? []).entries()) {
      const def = getPayload(pid);
      payloadRow.appendChild(el('button.payload-btn.warn', {
        'data-tip': `<b>${def.name}</b><br>${def.desc}`,
        onclick: () => {
          if (busy) return;
          if (def.target === 'enemy') {
            const first = c.state.enemies.find((e) => e.hp > 0);
            if (!first) return;
            if (usePayload(c, pid, first.id)) consumePayload(i);
          } else if (usePayload(c, pid, null)) {
            consumePayload(i);
          }
        },
      }, def.name));
    }
    rightPanel.append(
      el('div', { id: 'energy-orb', 'data-tip': 'Energy — refills every turn.' }, `${p.energy}`),
      el('div', { id: 'pile-counts' }, [
        el('span', { 'data-tip': 'Draw pile' }, `▲ ${p.draw.length}`),
        el('span', { 'data-tip': 'Discard pile' }, `▼ ${p.discard.length}`),
        el('span', { 'data-tip': 'Exhausted' }, `✕ ${p.exhaustPile.length}`),
      ]),
      payloadRow,
      el('button.warn', { id: 'btn-endturn', disabled: busy, onclick: doEndTurn }, 'END TURN [E]'),
    );
  }

  function consumePayload(index: number): void {
    game.run?.payloads.splice(index, 1);
    pump();
  }

  function renderHand(): void {
    const c = game.combat;
    if (!c) return;
    clear(handEl);
    const hand = c.state.player.hand;
    const n = hand.length;
    hand.forEach((inst, i) => {
      const node = cardEl(inst);
      const off = i - (n - 1) / 2;
      node.style.setProperty('--off', String(off));
      node.style.setProperty('--d2', String(Math.abs(off) * Math.abs(off) * 0.55));
      node.style.zIndex = String(i);
      const check = canPlay(c, inst.uid);
      if (!check.ok) node.classList.add('unplayable-now');
      if (inst.uid === selectedUid) node.classList.add('selected');
      const cost = cardCost(c, inst);
      const costEl = node.querySelector('.c-cost');
      if (costEl) costEl.textContent = effectiveCard(inst).cost === 'X' ? 'X' : String(cost);
      node.addEventListener('click', () => onCardClick(inst.uid));
      node.addEventListener('pointerenter', () => bus.emit('sfx', { name: 'hover' }));
      handEl.appendChild(node);
    });
  }

  function renderEnemies(): void {
    const c = game.combat;
    if (!c) return;
    clear(enemyTags);
    tagEls.clear();
    for (const e of c.state.enemies) {
      if (e.hp <= 0) continue;
      const tag = el('div.enemy-tag', { 'data-actor': e.id });
      const preview = intentPreview(c.state, c.rng, e);
      const statusChips = el('div.e-statuses');
      for (const [sid, nn] of Object.entries(e.statuses)) {
        const def = STATUSES[sid];
        if (!def) continue;
        statusChips.appendChild(el('span.status-chip', { 'data-kw': sid, style: `color:${def.color}` }, `${def.icon}${nn}`));
      }
      const phased = (e.statuses['phased'] ?? 0) > 0;
      tag.append(
        el('div.e-name', {}, e.name + (e.block > 0 ? ` 🛡${e.block}` : '') + (e.plating > 0 ? ` ◈${e.plating}` : '')),
        el('div.e-hpbar', {}, [el('div.fill', { style: `width:${(e.hp / e.hpMax) * 100}%` })]),
        el('div.e-hp', {}, `${e.hp}/${e.hpMax}`),
        el('div.e-intent', {}, intentText(e, preview)),
        statusChips,
      );
      if (selectedUid && !phased) {
        tag.classList.add('targetable');
        tag.addEventListener('click', () => commitCard(e.id));
      }
      enemyTags.appendChild(tag);
      tagEls.set(e.id, tag);
    }
  }

  function intentText(e: ActorState, p: ReturnType<typeof intentPreview>): string {
    if (!p) return '';
    const cd = e.flags['countdown'];
    const cdTxt = typeof cd === 'number' && cd > 0 ? ` ⏳${cd}` : '';
    if (p.damage != null) {
      const hits = (p.hits ?? 1) > 1 ? `×${p.hits}` : '';
      return `⚔ ${p.moveName} — ${p.damage}${hits ? ` (${Math.round(p.damage / (p.hits ?? 1))}${hits})` : ''}${cdTxt}`;
    }
    const glyph: Record<string, string> = {
      defend: '🛡', buff: '▲', debuff: '▼', summon: '✚', unknown: '?', attackDefend: '⚔🛡', attack: '⚔',
    };
    return `${glyph[p.kind] ?? '?'} ${p.moveName}${cdTxt}`;
  }

  // ---------------------------------------------------------------- input

  function onCardClick(uid: string): void {
    const c = game.combat;
    if (!c || busy) return;
    if (selectedUid === uid) { deselect(); return; }
    const inst = c.state.player.hand.find((x) => x.uid === uid);
    if (!inst) return;
    const check = canPlay(c, uid);
    if (!check.ok) { bus.emit('sfx', { name: 'deny' }); return; }
    const def = effectiveCard(inst);
    if (def.target === 'enemy') {
      selectedUid = uid;
      renderHand();
      renderEnemies();
    } else {
      if (playCard(c, uid, null)) pump();
    }
  }

  function commitCard(targetId: string): void {
    const c = game.combat;
    if (!c || !selectedUid || busy) return;
    const uid = selectedUid;
    deselect();
    if (playCard(c, uid, targetId)) pump();
  }

  function doEndTurn(): void {
    const c = game.combat;
    if (!c || busy || c.state.phase !== 'player') return;
    deselect();
    endTurn(c);
    pump();
  }

  // ---------------------------------------------------------------- event playback

  function pump(): void {
    const c = game.combat;
    if (!c) return;
    const events = drainEvents(c);
    busy = true;
    renderPlayer();
    renderHand();
    playEvents(events, 0);
  }

  function playEvents(events: CombatEvent[], i: number): void {
    const c = game.combat;
    if (!c) { busy = false; return; }
    if (i >= events.length) {
      busy = false;
      renderAll();
      // scout choice pending?
      if (c.state.scoutPending > 0) openScout();
      const phase = c.state.phase;
      if (phase === 'won' || phase === 'lost') {
        setTimeout(() => game.onCombatEnd(phase === 'won'), 900);
      }
      return;
    }
    const ev = events[i]!;
    bus.emit('combat:events', { events: [ev] });
    const delay = playOne(ev);
    if (delay > 0) renderEnemies();
    setTimeout(() => playEvents(events, i + 1), delay);
  }

  /** Apply one event's visuals; return the delay before the next event. */
  function playOne(ev: CombatEvent): number {
    const c = game.combat;
    if (!c) return 0;
    switch (ev.t) {
      case 'damage': {
        const targetEnemy = ev.targetId !== 'player';
        if (ev.evaded) {
          floatAt(ev.targetId, 'EVADED', 'var(--cyan)');
          return 240;
        }
        if (ev.sourceId === 'player' && targetEnemy) {
          const inst = c.state.player.hand; void inst;
          game.combatScene.playerAttack(ev.targetId, ev.archetype, ev.beam);
        } else if (ev.sourceId !== 'player' && !targetEnemy) {
          game.combatScene.enemyAttack(ev.sourceId);
          game.sm.flash(0.18);
        }
        const total = ev.amount + ev.blocked;
        floatAt(ev.targetId, ev.amount > 0 ? `-${ev.amount}` : `(${ev.blocked})`, ev.amount > 0 ? 'var(--red)' : 'var(--cyan)');
        renderPlayer();
        return total > 0 ? 320 : 200;
      }
      case 'hullLoss':
        floatAt(ev.targetId, `-${ev.amount} ${ev.cause}`, 'var(--red)');
        renderPlayer();
        return 260;
      case 'block':
        if (ev.amount > 0) {
          game.combatScene.shieldFx(ev.targetId);
          floatAt(ev.targetId, `+${ev.amount} 🛡`, 'var(--cyan)');
        }
        renderPlayer();
        return ev.amount > 0 ? 200 : 0;
      case 'heal':
        game.combatScene.healFx(ev.targetId);
        floatAt(ev.targetId, `+${ev.amount}`, 'var(--green)');
        renderPlayer();
        return 220;
      case 'status': {
        const def = STATUSES[ev.status];
        if (def && !['primed', 'phased', 'echo'].includes(ev.status)) {
          floatAt(ev.targetId, `${def.icon} ${def.name}`, def.color);
          return 200;
        }
        return 0;
      }
      case 'enemyMove': {
        const tag = tagEls.get(ev.actorId);
        if (tag) tag.style.outline = '1px solid var(--amber)';
        game.log(`${nameOf(ev.actorId)} uses ${ev.moveName}.`);
        return 360;
      }
      case 'summon':
        game.combatScene.addEnemy(ev.actorId, ev.enemyId);
        return 320;
      case 'die':
        game.combatScene.deathBurst(ev.actorId);
        game.log(`${nameOf(ev.actorId)} destroyed.`, 'good');
        return 380;
      case 'turnStart':
        renderPlayer();
        return 120;
      case 'draw':
        renderHand();
        return 100;
      case 'energy':
        renderPlayer();
        return 0;
      case 'cardPlayed':
        return 100;
      case 'exhaust':
        return 60;
      case 'enrage':
        game.log('HOSTILES ENRAGED — damage +50%.', 'bad');
        return 500;
      case 'text':
        game.log(ev.msg, ev.cls);
        return 220;
      case 'intents':
        renderEnemies();
        return 0;
      case 'win':
        game.log('Hostiles neutralized.', 'good');
        return 300;
      case 'lose':
        game.sm.flash(1.2);
        return 600;
      default:
        return 0;
    }
  }

  function nameOf(actorId: string): string {
    const c = game.combat;
    const e = c?.state.enemies.find((x) => x.id === actorId);
    return e?.name ?? 'It';
  }

  function floatAt(actorId: string, text: string, color: string): void {
    let pos: { x: number; y: number };
    if (actorId === 'player') {
      pos = game.sm.worldToScreen(game.combatScene.probePos());
    } else {
      pos = game.sm.worldToScreen(game.combatScene.enemyPos(actorId));
    }
    const f = el('div.floater', { style: `left:${pos.x}px; top:${pos.y - 20}px; color:${color}` }, text);
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 950);
  }

  // ---------------------------------------------------------------- scout

  function openScout(): void {
    const c = game.combat;
    if (!c) return;
    const n = c.state.scoutPending;
    const revealed = c.state.player.draw.slice(0, n);
    const toss = new Set<string>();
    const row = el('div', { id: 'scout-row' });
    for (const inst of revealed) {
      const node = cardEl(inst);
      node.addEventListener('click', () => {
        if (toss.has(inst.uid)) { toss.delete(inst.uid); node.classList.remove('tossing'); }
        else { toss.add(inst.uid); node.classList.add('tossing'); }
      });
      row.appendChild(node);
    }
    const overlay = el('div.overlay.visible', { id: 'scout-overlay', style: 'z-index:65' }, [
      el('div.modal-box.panel', { style: 'width:min(900px,96vw)' }, [
        el('div.ptitle', {}, [el('span', {}, `SCOUT — TOP ${n} OF DRAW PILE`), el('span.tag', {}, 'click to discard')]),
        row,
        el('div.modal-choices', {}, [
          el('button', {
            id: 'scout-confirm',
            onclick: () => {
              scoutResolve(c.state, [...toss]);
              overlay.remove();
              renderAll();
            },
          }, 'CONFIRM'),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------- screen api

  return {
    root,
    enter() {
      selectedUid = null;
      busy = false;
      pump();
      renderAll();
    },
    exit() {
      clear(enemyTags);
      tagEls.clear();
      arrow.setAttribute('d', '');
      document.getElementById('scout-overlay')?.remove();
    },
    update() {
      // position enemy tags over the 3D meshes
      for (const [id, tag] of tagEls) {
        const p = game.sm.worldToScreen(game.combatScene.enemyPos(id));
        tag.style.left = `${p.x}px`;
        tag.style.top = `${p.y - 130}px`;
      }
      // targeting arrow
      if (selectedUid) {
        const sel = handEl.querySelector<HTMLElement>('.card.selected');
        if (sel) {
          const r = sel.getBoundingClientRect();
          const x1 = r.left + r.width / 2, y1 = r.top;
          arrow.setAttribute('d', `M ${x1} ${y1} Q ${(x1 + mouse.x) / 2} ${Math.min(y1, mouse.y) - 80}, ${mouse.x} ${mouse.y}`);
        }
      }
    },
  };
}
