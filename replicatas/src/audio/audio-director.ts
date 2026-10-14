// audio-director.ts — subscribes to the bus; neither engine nor UI imports audio.
import { bus } from '@/core/bus';
import { audio } from './synth';
import { music, type Mood } from './music';
import type { CombatEvent } from '@/combat/combat-types';
import { getCard } from '@/content/registry';

const SFX: Record<string, () => void> = {
  tick: () => audio.tick(),
  hover: () => audio.hover(),
  confirm: () => audio.confirm(),
  deny: () => audio.deny(),
  chime: () => audio.chime(),
  alarm: () => audio.alarm(),
  warp: () => audio.warp(),
  boom: () => audio.boom(),
  ignite: () => audio.ignite(),
  forge: () => audio.forge(),
  loot: () => audio.loot(),
  victory: () => audio.victory(),
  defeat: () => audio.defeat(),
  explosion: () => audio.explosion(),
};

export function initAudioDirector(): void {
  bus.on('sfx', ({ name }) => SFX[name]?.());
  bus.on('music', ({ mood }) => music.setMood(mood as Mood));
  bus.on('combat:events', ({ events }) => {
    for (const ev of events) playCombatEvent(ev);
  });

  document.addEventListener('pointerdown', () => {
    try {
      audio.init();
      audio.resume();
      music.kick();
    } catch { /* audio unavailable */ }
  });
}

function playCombatEvent(ev: CombatEvent): void {
  switch (ev.t) {
    case 'draw': audio.cardDraw(); break;
    case 'cardPlayed': {
      try {
        const def = getCard(ev.cardId);
        if (def.kind === 'attack') {
          switch (def.archetype) {
            case 'laser': audio.cardPlayLaser(); break;
            case 'kinetic': audio.cardPlayKinetic(); break;
            case 'nuclear': audio.cardPlayNuclear(); break;
            case 'speed': audio.cardPlaySpeed(); break;
            default: audio.cardPlayKinetic();
          }
        } else if (def.archetype === 'repair') audio.cardPlayRepair();
        else audio.cardPlaySkill();
      } catch { audio.cardPlaySkill(); }
      break;
    }
    case 'damage':
      if (ev.evaded) audio.evade();
      else if (ev.amount + ev.blocked > 0) audio.hit(ev.amount >= 18 ? 1.6 : ev.amount >= 9 ? 1.1 : 0.8);
      break;
    case 'block': if (ev.amount > 0) audio.shieldFx(); break;
    case 'heal': audio.cardPlayRepair(); break;
    case 'status': audio.statusApply(); break;
    case 'die': audio.explosion(); break;
    case 'enemyMove': audio.enemyMove(); break;
    case 'enrage': audio.alarm(); break;
    case 'win': audio.victory(); break;
    case 'lose': audio.defeat(); break;
    default: break;
  }
}
