// statuses.ts — the 13 status effects. Statuses carry code (hooks); content references them by id.
import { BAL } from '@/core/balance';
import type { StatusDef } from './combat-types';
import { loseHull } from './effects';

const defs: StatusDef[] = [
  {
    id: 'force', name: 'Force', icon: '▲', color: '#ff8a4a', good: true,
    desc: 'Each attack hit you deal does +X damage.',
    stacking: 'intensity', decay: 'none',
    hooks: { modifyDamageDealt: (n, s, isAttack) => isAttack ? n + s : n },
  },
  {
    id: 'servos', name: 'Servos', icon: '⬡', color: '#71e8a4', good: true,
    desc: 'Shield-granting cards grant +X Shields.',
    stacking: 'intensity', decay: 'none',
    hooks: { modifyBlockGained: (n, s) => n + s },
  },
  {
    id: 'charge', name: 'Charge', icon: '✦', color: '#6fe0ef', good: true,
    desc: 'Your [BEAM] attacks deal +X damage per hit.',
    stacking: 'intensity', decay: 'none', cap: BAL.chargeCap,
    hooks: { modifyDamageDealt: (n, s, isAttack, beam) => isAttack && beam ? n + s : n },
  },
  {
    id: 'evasion', name: 'Evasion', icon: '≋', color: '#b8d7dd', good: true,
    desc: 'Negate the next X attack hits against you entirely.',
    stacking: 'intensity', decay: 'none',
    // consumed in the damage pipeline
  },
  {
    id: 'nanite', name: 'Nanite Swarm', icon: '✚', color: '#71e8a4', good: true,
    desc: 'At the end of your turn, restore X Hull, then X−1.',
    stacking: 'intensity', decay: 'none', cap: BAL.naniteCap,
    hooks: {
      onTurnEnd(ctx, stacks) {
        const a = ctx.actor;
        const healed = Math.min(stacks, a.hpMax - a.hp);
        if (healed > 0) {
          a.hp += healed;
          ctx.state.events.push({ t: 'heal', targetId: a.id, amount: healed, hp: a.hp });
        }
        if (a.flags['swarmDirector']) return; // Swarm Director power: no decay
        a.statuses['nanite'] = stacks - 1;
        if (a.statuses['nanite'] <= 0) delete a.statuses['nanite'];
      },
    },
  },
  {
    id: 'reactive', name: 'Reactive Armor', icon: '✱', color: '#ffb454', good: true,
    desc: 'When an attack hits you, the attacker takes X.',
    stacking: 'intensity', decay: 'none', cap: BAL.reactiveArmorCap,
    // applied in the damage pipeline
  },
  {
    id: 'exposed', name: 'Exposed', icon: '◎', color: '#ff5d4a', good: false,
    desc: 'Takes +50% damage from attacks. X turns.',
    stacking: 'turns', decay: 'turnEnd',
    hooks: { modifyDamageTaken: (n, _s, isAttack) => isAttack ? Math.floor(n * BAL.exposedMult) : n },
  },
  {
    id: 'jammed', name: 'Jammed', icon: '≠', color: '#b48cff', good: false,
    desc: 'Attacks deal −25% damage. X turns.',
    stacking: 'turns', decay: 'turnEnd',
    hooks: { modifyDamageDealt: (n, _s, isAttack) => isAttack ? Math.floor(n * BAL.jammedMult) : n },
  },
  {
    id: 'corrosion', name: 'Corrosion', icon: '☵', color: '#9ccc44', good: false,
    desc: 'At the start of the turn: lose X Hull (pierces Shields), then X−1.',
    stacking: 'intensity', decay: 'none',
    hooks: {
      onTurnStart(ctx, stacks) {
        loseHull(ctx.state, ctx.actor, stacks, 'corrosion');
        ctx.actor.statuses['corrosion'] = stacks - 1;
        if (ctx.actor.statuses['corrosion'] <= 0) delete ctx.actor.statuses['corrosion'];
      },
    },
  },
  {
    id: 'radiation', name: 'Radiation', icon: '☢', color: '#d4f04a', good: false,
    desc: 'At the start of the turn: lose X Hull (pierces Shields), then X halves.',
    stacking: 'intensity', decay: 'none',
    hooks: {
      onTurnStart(ctx, stacks) {
        // Rad Scrubbers upgrade: remove 1 before it ticks
        let s = stacks;
        if (ctx.actor.flags['radScrubbers']) {
          s = Math.max(0, s - 1);
          if (s === 0) { delete ctx.actor.statuses['radiation']; return; }
          ctx.actor.statuses['radiation'] = s;
        }
        loseHull(ctx.state, ctx.actor, s, 'radiation');
        const next = Math.floor(s / 2);
        if (next <= 0) delete ctx.actor.statuses['radiation'];
        else ctx.actor.statuses['radiation'] = next;
      },
    },
  },
  {
    id: 'overheat', name: 'Overheat', icon: '♨', color: '#ff8a4a', good: false,
    desc: 'At the end of your turn: take X damage (Shields absorb it), then remove all Overheat.',
    stacking: 'intensity', decay: 'none',
    hooks: {
      onTurnEnd(ctx, stacks) {
        const a = ctx.actor;
        let dmg = stacks;
        const exempt = typeof a.flags['heatPumps'] === 'number' ? (a.flags['heatPumps'] as number) : 0;
        if (exempt > 0) dmg = Math.max(0, dmg - exempt);
        if (dmg > 0) {
          const blocked = Math.min(a.block, dmg);
          a.block -= blocked;
          const hpLoss = dmg - blocked;
          if (hpLoss > 0) loseHull(ctx.state, a, hpLoss, 'overheat');
          else ctx.state.events.push({ t: 'text', msg: 'Shields absorb the overheat.' });
        }
        delete a.statuses['overheat'];
      },
    },
  },
  {
    id: 'empd', name: "EMP'd", icon: '⌁', color: '#6fe0ef', good: false,
    desc: 'Skips its next intent.',
    stacking: 'intensity', decay: 'none',
  },
  {
    id: 'brownout', name: 'Brownout', icon: '▽', color: '#b48cff', good: false,
    desc: 'Gain X less ⚡ next turn.',
    stacking: 'intensity', decay: 'none', // consumed at turn refill
  },
  // hidden helper: Overpressure's "next attack +X"
  {
    id: 'primed', name: 'Primed', icon: '➤', color: '#ffb454', good: true,
    desc: 'Your next Attack this turn deals +X (each hit).',
    stacking: 'intensity', decay: 'clearTurnEnd',
    hooks: { modifyDamageDealt: (n, s, isAttack) => isAttack ? n + s : n },
  },
  // hidden helper: burrowed/phased — untargetable
  {
    id: 'phased', name: 'Phased', icon: '◌', color: '#527078', good: true,
    desc: 'Untargetable this turn.',
    stacking: 'turns', decay: 'turnStart',
  },
  // hidden helper: Future Echo
  {
    id: 'echo', name: 'Echo', icon: '∞', color: '#b48cff', good: true,
    desc: 'The next card you play this turn is played twice.',
    stacking: 'intensity', decay: 'clearTurnEnd',
  },
];

export const STATUSES: Record<string, StatusDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export function statusDef(id: string): StatusDef {
  const d = STATUSES[id];
  if (!d) throw new Error(`unknown status: ${id}`);
  return d;
}
