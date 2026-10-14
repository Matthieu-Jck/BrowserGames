// payloads.ts — consumables (the potion slot). Usable once, in combat only.
import type { EffectOp } from '@/combat/combat-types';

export interface PayloadDef {
  name: string;
  desc: string;
  target: 'enemy' | 'allEnemies' | 'none';
  cost: number;                 // fabricator price (minerals)
  act2Plus?: boolean;
  effects: EffectOp[];
}

export const PAYLOADS = {
  repair_canister: {
    name: 'Repair Canister', desc: 'Restore 12 Hull.', target: 'none', cost: 20,
    effects: [{ op: 'heal', amount: 12 }],
  },
  missile: {
    name: 'Missile', desc: 'Deal 12 damage.', target: 'enemy', cost: 22,
    effects: [{ op: 'damage', amount: 12 }],
  },
  emp_charge: {
    name: 'EMP Charge', desc: 'A mech enemy skips its next move.', target: 'enemy', cost: 25,
    effects: [{ op: 'status', status: 'empd', stacks: 1, to: 'target' }],
  },
  coolant_flush: {
    name: 'Coolant Flush', desc: 'Remove all Overheat and 3 of your Radiation.', target: 'none', cost: 20,
    effects: [
      { op: 'removeStatus', status: 'overheat', on: 'self', amount: 'all' },
      { op: 'removeStatus', status: 'radiation', on: 'self', amount: 3 },
    ],
  },
  shield_cell: {
    name: 'Shield Cell', desc: 'Gain 12 Shields.', target: 'none', cost: 20,
    effects: [{ op: 'block', amount: 12 }],
  },
  overdrive_module: {
    name: 'Overdrive Module', desc: 'Gain 2⚡.', target: 'none', cost: 30,
    effects: [{ op: 'energy', delta: 2 }],
  },
  nanite_ampoule: {
    name: 'Nanite Ampoule', desc: 'Gain 4 Nanite Swarm.', target: 'none', cost: 25,
    effects: [{ op: 'status', status: 'nanite', stacks: 4, to: 'self' }],
  },
  singularity_grenade: {
    name: 'Singularity Grenade', desc: 'Deal 25 to ALL enemies.', target: 'allEnemies', cost: 40, act2Plus: true,
    effects: [{ op: 'damage', amount: 25 }],
  },
} satisfies Record<string, PayloadDef>;

export type PayloadId = keyof typeof PAYLOADS;
