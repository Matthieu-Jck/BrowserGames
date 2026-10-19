// tokens.ts — the colour tokens of Ocelle's look: Moebius-style inked sci-fi. Warm desert
// pastels for the land; saturated painted machinery (coral, turquoise, lilac) on blue-steel
// and brass structures, with glowing cyan / amber lights for contrast. Ink is a deep violet-
// black, never pure black; night is lilac, never dark grey.

export const C = {
  ink: '#1b1830',
  inkSoft: '#363150',
  paper: '#fbf1e4',
  paperD: '#f1e2cc',
  peach: '#f2bf94', peachL: '#f8dcc0', peachD: '#d2976b',
  coral: '#ec5f43', coralL: '#f58d72', coralD: '#b8402a',
  turq: '#1fb2a8', turqL: '#7fd9cf', turqD: '#147d76',
  lilac: '#8e78c8', lilacL: '#c2b4e8', lilacD: '#5e4b97',
  sand: '#eed7b8', dune: '#e2b994', mesa: '#d98e73', salt: '#f6ede2',
  warn: '#f2a33a',
  glowTurq: '#62f6ee', glowPeach: '#ffd99e', glowCyan: '#7ff7ff',
  // machinery: cool painted metals, hot accents
  steel: '#38446a', steelL: '#6c84b6', steelD: '#232b48', steelDD: '#151a2e',
  teal: '#12808f', tealL: '#3fb6c6', cyan: '#2fc6dc', ice: '#bfe9f3', violet: '#6a58d2', violetL: '#9d8ff0',
  brass: '#d39a3c', brassL: '#f0c56d', hazard: '#f2b33d',
  led: '#7ff7ff', ledWarm: '#ffbf6b', ledRed: '#ff5a4a', ledGreen: '#8dff9e',
  // terrain
  cirque: '#f0d5b4',
  hardpan: '#dfb994',
  // rock by hardness H1–H4 (2026-10-16): one warm desert family from ochre to plum heartrock, as
  // the relief draws it (rock.ts `ROCK`; the lilac rock is gone: violet only in the shade)
  rock1: '#e6aa80', rock2: '#d58f6c', rock3: '#bd7866', rock4: '#8c5e6c',
  shallow: '#8dd8ce', deep: '#3fb2a8', deepD: '#26857e',
  vent: '#6e4f6c', dug: '#d9b896', filled: '#e3c6a4', duneSea: '#e5c09d',
  // map 4's gaps (D94): a river's running water (bluer than the still lakes), a chasm's dark and its lit far wall
  river: '#5ab7cf', riverD: '#2f8fb0', chasm: '#2a2236', chasmWall: '#6a5677',
} as const;

export type ColorToken = keyof typeof C;

/** '#rrggbb' → 0xrrggbb for Pixi. */
export const num = (hex: string): number => parseInt(hex.slice(1), 16);

/** Mix two hex colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const m = (s: number): number => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

/** rgba() string from a hex token. */
export function rgba(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}

/** Push the palette to CSS custom properties (--t-<token>) so DOM and canvas agree. */
export function pushTokensToCss(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(C)) root.style.setProperty(`--t-${k}`, v);
}
