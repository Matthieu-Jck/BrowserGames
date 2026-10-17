// cfg.ts — the bit layout of an entity's `cfg` word, in one place (the compiler, the systems
// and the UI all read it through these helpers). Machines: recipe index + 1 in the low 16 bits
// (0 = none); bits 16–19 held the speed modules fitted, gone since D81 (the load hands any still
// there back to the Heart as servomotors and clears them: `modulesOf`, `withModules`). Routing blocks: a router's
// output filter per side, item index + 1 in byte `side` (0 = anything); a sorter's or inverted
// sorter's chosen item in byte 0. Values stay unsigned 32-bit.

/** A machine's recipe as `index + 1` (0 = no recipe). */
export const recipeOf = (cfg: number): number => cfg & 0xffff;

/** Speed modules a machine had fitted in an old save (D81: read once at load, then cleared). */
export const modulesOf = (cfg: number): number => (cfg >>> 16) & 0xf;

/** The cfg with another recipe (`index + 1`, 0 = none); modules are kept. */
export const withRecipe = (cfg: number, r: number): number => ((cfg & ~0xffff) | (r & 0xffff)) >>> 0;

/** The cfg with `n` speed modules (0 at load, D81); the recipe is kept. */
export const withModules = (cfg: number, n: number): number => ((cfg & 0xffff) | ((n & 0xf) << 16)) >>> 0;

/** A fork's filter on a side: the item index, or -1 when the side takes anything. */
export const filterOf = (cfg: number, side: number): number => ((cfg >>> (side * 8)) & 0xff) - 1;

/** The cfg with a side's filter set to an item index (-1 clears it). */
export const withFilter = (cfg: number, side: number, item: number): number =>
  ((cfg & ~(0xff << (side * 8))) | (((item + 1) & 0xff) << (side * 8))) >>> 0;
