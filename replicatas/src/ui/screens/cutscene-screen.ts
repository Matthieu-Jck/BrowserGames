// cutscene-screen.ts — plays CUTSCENES line sequences over the space scene.
import { el } from '../dom';
import type { Game, Screen } from '@/game';
import { CUTSCENES } from '@/content/story';
import { bus } from '@/core/bus';

export interface CutscenePayload {
  key: string;
  then(): void;
}

export function createCutsceneScreen(game: Game): Screen {
  void game;
  const root = el('section');
  const skip = el('button.ghost', { id: 'cutscene-skip' }, 'SKIP ▸');
  root.appendChild(skip);

  let timer: number | null = null;
  let done: (() => void) | null = null;
  let finished = false;

  function finish(): void {
    if (finished) return;
    finished = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const sub = document.getElementById('subtitle');
    sub?.classList.remove('show');
    const cb = done;
    done = null;
    cb?.();
  }

  skip.addEventListener('click', finish);

  return {
    root,
    enter(payload) {
      const p = payload as CutscenePayload;
      const scene = CUTSCENES[p.key];
      finished = false;
      done = p.then;
      if (!scene) { finish(); return; }
      if (scene.mood) bus.emit('music', { mood: scene.mood });
      let i = 0;
      const next = (): void => {
        if (i >= scene.lines.length) { timer = window.setTimeout(finish, 600); return; }
        const line = scene.lines[i++]!;
        bus.emit('subtitle', { text: line.text, secs: (line.secs ?? 4.5) - 0.4 });
        timer = window.setTimeout(next, (line.secs ?? 4.5) * 1000);
      };
      next();
    },
    exit() {
      if (timer) { clearTimeout(timer); timer = null; }
      document.getElementById('subtitle')?.classList.remove('show');
    },
  };
}
