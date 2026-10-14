// kinds.ts — shared string unions, kept here so the bus, UI and debug handle can be typed
// without import cycles.

export type Locale = 'fr' | 'en';
export const LOCALES: readonly Locale[] = ['fr', 'en'];

export type ScreenId =
  | 'boot' | 'hud' | 'research' | 'market' | 'stats' | 'absence' | 'settings'
  | 'catchup' | 'conflict' | 'artboard' | 'intro' | 'menu';

export type ToolId = 'build' | 'belt' | 'deconstruct' | 'dig';

export type OverlayId = 'zones' | 'power' | 'flow';

/** The two views of the colony: iso to look and manage, plan to build. */
export type ViewMode = 'iso' | 'plan';

export type NotifyKind = 'info' | 'good' | 'warn' | 'bad';
