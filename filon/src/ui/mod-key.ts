// mod-key.ts — how this keyboard writes the chords' modifier in a hint (D154: Ctrl/⌘+C, V, Z):
// « ⌘ » on an Apple keyboard, « Ctrl+ » elsewhere. One place, so every hint names the same key.

/** The modifier's cap, ready to put before a letter: « ⌘ » (⌘C) or « Ctrl+ » (Ctrl+C). */
export function modCap(): string {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const platform = (nav as (Navigator & { userAgentData?: { platform?: string } }) | null)?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl+';
}
