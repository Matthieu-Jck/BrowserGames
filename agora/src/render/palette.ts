// palette.ts — a monochrome world plus one accent. The accent shifts per chapter and
// is bridged to CSS custom properties so the DOM panels and the canvas always agree.
import { bus } from '@/core/bus';

export interface Palette {
  bg: string;
  ink: string; // primary text / bright marks
  dim: string; // secondary text / faint marks
  faint: string; // grid lines
  buyer: string; // demand side
  seller: string; // supply side
  accent: string; // the chapter's colour
  danger: string; // shortages, collapse, deadweight
  warn: string;
  good: string;
}

export const palette: Palette = {
  bg: '#070b14',
  ink: '#e8eef7',
  dim: '#8a99b3',
  faint: 'rgba(150,170,200,0.13)',
  buyer: '#5fd4f5',
  seller: '#ffbe5c',
  accent: '#5fe39a',
  danger: '#ff5a52',
  warn: '#ffb454',
  good: '#4fe39a',
};

let currentAccent = palette.accent;

/** Convert a #rrggbb to an rgba() string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getAccent(): string {
  return currentAccent;
}

/** Set the live accent colour, push it to CSS, and announce it on the bus. */
export function setAccent(color: string): void {
  currentAccent = color;
  palette.accent = color;
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-soft', withAlpha(color, 0.16));
    document.documentElement.style.setProperty('--accent-glow', withAlpha(color, 0.45));
  }
  bus.emit('accent:set', { color });
}
