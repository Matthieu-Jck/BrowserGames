// keycap.ts — the letter printed on a key the game binds by its position (`KeyboardEvent.code`,
// input/bindings.ts: movement, the pipette), for the hints that name it. The keyboard's layout
// decides it, not the language: a French player on QWERTY presses Q for the pipette, an English
// one on AZERTY presses A (the roadmap's debt until 2026-10-15: the hints named it by language).
// Learned, best first:
//   · the browser's layout map (`navigator.keyboard.getLayoutMap()`: Chromium; asked once, on the
//     first hint) gives every position's letter;
//   · the keys the player presses (a keydown tells the letter at its code), and AZERTY's signature —
//     its A and Q, Z and W swapped — tells the pipette's from the first pan with ZQSD or WASD;
//   · until then, the language's guess (`key.pipette` in fr.ts / en.ts: A, Q), as before.
// Nothing is saved: a new session learns again in its first seconds.
import { t } from '@/i18n/i18n';

/** The pipette's position (input/bindings.ts `BINDINGS.pipette`; keycap.test.ts keeps them in step). */
export const PIPETTE_CODE = 'KeyQ';

/** Each position's letter, as learnt (upper case). */
const caps = new Map<string, string>();
/** Positions told only by a layout's signature: a key seen or the layout map overrides them. */
const guessed = new Set<string>();
let listening = false;

/** Learn the letter at `code`; AZERTY's swaps (and QWERTY's, QWERTZ's, Colemak's W) tell the top-left letters. */
export function noteKey(code: string, key: string): void {
  if (key.length !== 1 || key === ' ') return;
  caps.set(code, key.toUpperCase());
  guessed.delete(code);
  const k = key.toLowerCase();
  const guess = (c: string, cap: string): void => { if (!caps.has(c) || guessed.has(c)) { caps.set(c, cap); guessed.add(c); } };
  // A on Q's place, or Z on W's: AZERTY (French, Belgian) — its A where QWERTY has Q.
  if ((code === 'KeyA' && k === 'q') || (code === 'KeyW' && k === 'z')) { guess('KeyQ', 'A'); guess('KeyW', 'Z'); guess('KeyA', 'Q'); guess('KeyZ', 'W'); }
  // W on its own place: QWERTY, QWERTZ, Colemak — all keep Q there (Dvorak puts a comma on KeyW).
  else if (code === 'KeyW' && k === 'w') guess('KeyQ', 'Q');
}

/** Start learning: the layout map once, and every key the player presses from now on (browser only). */
function listen(): void {
  if (listening) return;
  listening = true;
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) noteKey(e.code, e.key); }, { capture: true, passive: true });
  const kb = (navigator as { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }).keyboard;
  kb?.getLayoutMap?.().then((m) => {
    for (const [code, key] of m) if (key.length === 1 && key !== ' ') { caps.set(code, key.toUpperCase()); guessed.delete(code); }
  }).catch(() => { /* not allowed here (a frame, an old browser): the keys pressed will tell */ });
}

/** The letter on the key at `code` for this player's keyboard, or null while it is not known. */
export function keyCap(code: string): string | null {
  listen();
  return caps.get(code) ?? null;
}

/** Forget what was learnt (the tests start from an unknown keyboard). */
export function forgetKeys(): void { caps.clear(); guessed.clear(); }

/** The pipette's key as the hints name it: the player's own, else the language's guess. */
export const pipetteCap = (): string => keyCap(PIPETTE_CODE) ?? t('key.pipette');
