// bindings.ts — keyboard bindings. Movement, pipette and the digit row use PHYSICAL codes
// (so AZERTY gets ZQSD and the pipette on its A key, and digits work without Shift);
// mnemonic actions use the layout's letter (M = marché wherever M sits).

export type Action =
  | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'fast'
  | 'rotate' | 'pipette' | 'deconstruct' | 'cancel' | 'undo'
  | 'zoomIn' | 'zoomOut'
  | 'ovPower' | 'ovFlow'
  | 'scrResearch' | 'scrMarket' | 'scrStats' | 'home' | 'perf' | 'build' | 'mark'
  | 'link' | 'land' | 'hideUi';

interface Binding { codes?: readonly string[]; keys?: readonly string[] }

export const BINDINGS: Record<Action, Binding> = {
  panUp: { codes: ['KeyW', 'ArrowUp'] },
  panDown: { codes: ['KeyS', 'ArrowDown'] },
  panLeft: { codes: ['KeyA', 'ArrowLeft'] },
  panRight: { codes: ['KeyD', 'ArrowRight'] },
  fast: { codes: ['ShiftLeft', 'ShiftRight'] },
  rotate: { keys: ['r'] },
  pipette: { codes: ['KeyQ'] },
  deconstruct: { keys: ['x'] },
  cancel: { codes: ['Escape'] },
  undo: { keys: ['z'] }, // with Ctrl/Cmd only (checked by the caller)
  // The two keys right of the digit row, by position: - = on QWERTY, ) = on AZERTY (whose -
  // sits on the 6, a build slot); numpad + − everywhere.
  zoomIn: { codes: ['Equal', 'NumpadAdd'], keys: ['+'] },
  zoomOut: { codes: ['Minus', 'NumpadSubtract'] },
  ovPower: { keys: ['p'] },
  ovFlow: { keys: ['f'] },
  scrResearch: { keys: ['t'] },
  scrMarket: { keys: ['m'] },
  scrStats: { keys: ['g'] },
  home: { keys: ['h'] },
  perf: { codes: ['Backquote', 'IntlBackslash'] },
  build: { keys: ['b'] },
  mark: { keys: ['c'] },
  link: { keys: ['l'] }, // Relier / Link: the power wires tool (D25; KeyL on both layouts)
  // The land mode (D60): buy or lease parcels. I — « immobilier » — was the zones' overlay, the
  // map of where one may build that the parcels replace; KeyI on both layouts.
  land: { keys: ['i'] },
  // Hide the interface to look at the base (owner, 2026-10-12: « the menus and explanations
  // sometimes hide the game too much »); KeyU on both layouts.
  hideUi: { keys: ['u'] },
};

/** Which action does this key event trigger (first match, codes before keys)? */
export function actionOf(e: Pick<KeyboardEvent, 'code' | 'key'>): Action | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const [a, b] of Object.entries(BINDINGS) as Array<[Action, Binding]>) {
    if (b.codes?.includes(e.code)) return a;
  }
  for (const [a, b] of Object.entries(BINDINGS) as Array<[Action, Binding]>) {
    if (b.keys?.includes(key)) return a;
  }
  return null;
}

/** Build-bar slot for a digit-row key (Digit1 → 0 … Digit0 → 9), by physical code. */
export function slotOf(code: string): number | null {
  const m = /^Digit(\d)$/.exec(code);
  if (!m) return null;
  const d = Number(m[1]);
  return d === 0 ? 9 : d - 1;
}

/** Is this action a held (continuous) one? */
export const HELD: ReadonlySet<Action> = new Set(['panUp', 'panDown', 'panLeft', 'panRight', 'fast']);

export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * What a key press means, all precedence in one place: with Ctrl / Cmd only undo exists (by
 * the layout's letter: AZERTY's Z sits where QWERTY has W); the digit row picks build slots
 * by position (Shift: a category); then physical codes, then layout letters.
 */
export function resolveKey(e: KeyEventLike): { slot: number; shift: boolean } | { action: Action } | null {
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return BINDINGS.undo.keys?.includes(key) ? { action: 'undo' } : null;
  }
  const slot = slotOf(e.code);
  if (slot !== null && !e.altKey) return { slot, shift: e.shiftKey };
  const a = actionOf(e);
  return a && a !== 'undo' ? { action: a } : null;
}
