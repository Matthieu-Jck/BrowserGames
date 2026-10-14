// combat-types.ts — the data contracts the whole game hangs off:
// cards, enemies, statuses, the effect language, and combat state/events.
import type { Rng } from '@/core/rng';

export type Archetype = 'laser' | 'kinetic' | 'nuclear' | 'speed' | 'repair' | 'neutral' | 'paradox' | 'status';
export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'special';
export type CardKind = 'attack' | 'skill' | 'power' | 'curse' | 'statusCard';
export type TargetMode = 'enemy' | 'allEnemies' | 'randomEnemy' | 'self' | 'none';
export type CardSource = 'starter' | 'base' | 'meta' | 'drop' | 'special';

// ---------------------------------------------------------------- amounts & conditions

export type Amount = number | {
  base: number;
  perStatus?: { status: string; on: 'self' | 'target'; mult: number };
  perCardsExhausted?: number;   // × cards exhausted this combat
  perCardsPlayed?: number;      // × cards played this turn (before this one)
};

export type Condition =
  | { kind: 'targetHasStatus'; status: string; min?: number }
  | { kind: 'selfHasStatus'; status: string; min?: number }
  | { kind: 'selfHpBelow'; frac: number }
  | { kind: 'targetHpBelow'; frac: number }
  | { kind: 'energyAtLeast'; n: number }
  | { kind: 'turnAtLeast'; n: number };

// ---------------------------------------------------------------- the effect language
// Cards AND enemy moves are interpreted by the same engine.

export type EffectOp =
  | { op: 'damage'; amount: Amount; times?: number | 'X'; piercing?: boolean; onKill?: EffectOp[] }
  | { op: 'block'; amount: Amount; who?: 'self' | 'allyOther' }
  | { op: 'heal'; amount: Amount; who?: 'self' | 'allyOther' }
  | { op: 'status'; status: string; stacks: Amount; to: 'target' | 'self' | 'allEnemies' | 'player' }
  | { op: 'removeStatus'; status: string; on: 'self' | 'target'; amount?: number | 'all' }
  | { op: 'draw'; count: Amount }
  | { op: 'energy'; delta: number }
  | { op: 'selfDamage'; amount: Amount }            // direct hull loss (nuclear costs etc.)
  | { op: 'scout'; count: number }
  | { op: 'stripBlock'; on: 'target' | 'self' | 'player' }
  | { op: 'resource'; resource: 'minerals' | 'fuel' | 'data'; delta: number }
  | { op: 'addCard'; card: string; to: 'hand' | 'draw' | 'discard'; copies?: number; costsZeroThisTurn?: boolean }
  | { op: 'summon'; enemy: string; count?: number; cap?: number }
  | { op: 'die' }                                   // self-destruct (Hawking Wisp evaporate)
  | { op: 'if'; cond: Condition; then: EffectOp[]; else?: EffectOp[] }
  | { op: 'addTurnStartOps'; ops: EffectOp[] }      // powers: run these at every turn start
  | { op: 'setFlag'; flag: string; value: number | boolean }  // powers: engine behavior switches
  | { op: 'custom'; script: string };               // escape hatch — combat/scripts.ts registry

// ---------------------------------------------------------------- cards

export interface CardDef {
  name: string;
  archetype: Archetype;
  kind: CardKind;
  rarity: Rarity;
  cost: number | 'X';
  target: TargetMode;
  text: string;
  effects: EffectOp[];
  beam?: boolean;                                   // [BEAM] tag — benefits from Charge
  exhaust?: boolean;
  innate?: boolean;
  retain?: boolean;
  unplayable?: boolean;
  playableIf?: Condition;
  endOfTurn?: EffectOp[];                           // status-card behavior (Hull Breach)
  refit?: { cost?: number | 'X'; effects?: EffectOp[]; text?: string; exhaust?: boolean };
  source: CardSource;
  flavor?: string;
}

export interface CardInstance {
  uid: string;
  cardId: string;
  refitted: boolean;
}

// ---------------------------------------------------------------- statuses

export interface HookCtx {
  state: CombatState;
  actor: ActorState;            // the actor owning the status
  rng: Rng;
}

export interface StatusDef {
  id: string;
  name: string;
  icon: string;                 // single glyph for the UI
  color: string;
  desc: string;
  good: boolean;                // buff (true) or debuff
  stacking: 'intensity' | 'turns';
  decay: 'turnEnd' | 'turnStart' | 'none' | 'halveTurnStart' | 'clearTurnEnd';
  cap?: number;
  hooks?: {
    modifyDamageDealt?(n: number, stacks: number, isAttack: boolean, beam: boolean): number;
    modifyDamageTaken?(n: number, stacks: number, isAttack: boolean): number;
    modifyBlockGained?(n: number, stacks: number): number;
    onTurnStart?(ctx: HookCtx, stacks: number): void;
    onTurnEnd?(ctx: HookCtx, stacks: number): void;
  };
}

// ---------------------------------------------------------------- enemies

export type Faction = 'fauna' | 'machine' | 'rogueProbe' | 'replica' | 'anomaly' | 'structure';
export type EnemyTier = 'normal' | 'elite' | 'boss' | 'summon';

export interface EnemyVisualSpec {
  bodyPlan: 'crawler' | 'floater' | 'swarm' | 'turret' | 'probe' | 'colossus' | 'amorphous' | 'wisp' | 'obelisk';
  scale: number;
  palette: { base: string; accent: string; emissive: string };
  idle: 'hover' | 'pulse' | 'skitter' | 'rotate';
}

export type IntentKind = 'attack' | 'attackDefend' | 'defend' | 'buff' | 'debuff' | 'summon' | 'unknown';

export interface EnemyMove {
  id: string;
  name: string;
  intent: IntentKind;
  weight?: number;
  cond?: Condition;             // gate for weighted mode
  effects: EffectOp[];
}

export interface EnemyDef {
  name: string;
  desc: string;
  faction: Faction;
  act: 1 | 2 | 3;
  tier: EnemyTier;
  hp: [number, number];
  plating?: number;             // flat reduction per hit taken
  mech?: boolean;               // EMP-able
  visual: EnemyVisualSpec;
  ai: { mode: 'cycle' | 'weighted' | 'script'; script?: string; noRepeat?: boolean };
  moves: EnemyMove[];
  loot: {
    minerals: [number, number];
    data: [number, number];
    cardDrop?: { card: string; chance: number };
    trophy?: { upgrade: string; chance: number };
  };
}

// ---------------------------------------------------------------- combat state

export interface ActorState {
  id: string;                   // 'player' | 'e0' | 'e1'...
  kind: 'player' | 'enemy';
  name: string;
  hp: number;
  hpMax: number;
  block: number;
  statuses: Record<string, number>;
  plating: number;
  // enemy only
  enemyId?: string;
  tier?: EnemyTier;
  mech?: boolean;
  moveIndex: number;
  lastMoveId?: string;
  intentMoveId?: string | null;
  turnsAlive: number;
  flags: Record<string, number | boolean>;
}

export interface PlayerCombat extends ActorState {
  kind: 'player';
  energy: number;
  energyMax: number;
  hand: CardInstance[];
  draw: CardInstance[];
  discard: CardInstance[];
  exhaustPile: CardInstance[];
  cardsPlayedThisTurn: number;
  cardsExhaustedThisCombat: number;
  lastPlayedCardId: string | null;
  zeroCostUids: string[];       // cards made free this turn
  turnStartOps: EffectOp[];     // installed by power cards
  retainCount: number;
}

export interface CombatState {
  turn: number;
  phase: 'player' | 'enemy' | 'won' | 'lost';
  player: PlayerCombat;
  enemies: ActorState[];
  events: CombatEvent[];
  deckCardIds: string[];        // snapshot for Paradox Echo
  encounterEnemyIds: string[];
  ambient: 'surface' | 'orbital';
  enrageApplied: boolean;
  scoutPending: number;         // cards available to discard via scout UI
  damageScale: number;          // planet-position scaling applied to enemy damage
}

// ---------------------------------------------------------------- combat events (UI feed)

export type CombatEvent =
  | { t: 'combatStart' }
  | { t: 'turnStart'; turn: number }
  | { t: 'draw'; uids: string[] }
  | { t: 'energy'; value: number }
  | { t: 'cardPlayed'; uid: string; cardId: string; targetId: string | null }
  | { t: 'damage'; sourceId: string; targetId: string; amount: number; blocked: number; hp: number; evaded?: boolean; beam?: boolean; archetype?: Archetype }
  | { t: 'block'; targetId: string; amount: number; total: number }
  | { t: 'heal'; targetId: string; amount: number; hp: number }
  | { t: 'hullLoss'; targetId: string; amount: number; hp: number; cause: string }
  | { t: 'status'; targetId: string; status: string; stacks: number; total: number }
  | { t: 'statusRemoved'; targetId: string; status: string }
  | { t: 'exhaust'; uid: string }
  | { t: 'discardHand' }
  | { t: 'addCard'; cardId: string; to: string }
  | { t: 'summon'; enemyId: string; actorId: string }
  | { t: 'enemyMove'; actorId: string; moveId: string; moveName: string }
  | { t: 'die'; actorId: string }
  | { t: 'intents' }
  | { t: 'scout'; count: number }
  | { t: 'enrage' }
  | { t: 'text'; msg: string; cls?: 'good' | 'bad' | 'warn' }
  | { t: 'win' }
  | { t: 'lose' };

// ---------------------------------------------------------------- intent preview

export interface IntentPreview {
  kind: IntentKind;
  moveName: string;
  damage?: number;              // total damage with modifiers
  hits?: number;
}
