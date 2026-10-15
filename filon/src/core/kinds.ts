// kinds.ts — shared string unions, kept here so the bus, UI and debug handle can be typed
// without import cycles.

export type Locale = 'fr' | 'en';
export const LOCALES: readonly Locale[] = ['fr', 'en'];

export type ScreenId =
  | 'boot' | 'hud' | 'research' | 'market' | 'stats' | 'absence' | 'settings'
  | 'catchup' | 'conflict' | 'artboard' | 'intro' | 'menu';

export type ToolId = 'build' | 'belt' | 'deconstruct' | 'dig';

/**
 * The specialised views (D88): one at a time, each drawing one system bold over the base dimmed —
 * Normal (none), Électricité, Logistique, Production, and Terrain (the land mode, D60).
 */
export type MapView = 'normal' | 'power' | 'logistics' | 'production' | 'land';
export const MAP_VIEWS: readonly MapView[] = ['normal', 'power', 'logistics', 'production', 'land'];

/** The two views of the colony: iso to look and manage, plan to build. */
export type ViewMode = 'iso' | 'plan';

export type NotifyKind = 'info' | 'good' | 'warn' | 'bad';
