// intro-name.ts — the company name the player registers in the intro (D31), as pure rules. The
// name goes through the same cleaning as the `name` command (`cleanName`: control characters
// dropped, spaces folded, 1 to COLONY_NAME_MAX characters), then it must be free: no sister
// claim's name (in either language: the pinned ones and those the market draws from the world
// seed), none of CrierBelt's or the world's own names, and nothing passing itself off as
// CrierBelt. Names are compared the way a register would: no case, no accents, « œ » spelt
// out, any run of dashes, apostrophes or spaces counted as one gap — so « port ecume » is
// Port-Écume.
//
// `checkName` returns a promise: today it answers at once from this list. The future server
// (other players' companies) plugs in as `NameRegister.remote`, consulted only once the local
// rules pass, so the common refusals stay instant and offline. Also here: the refusals'
// wording (CrierBelt's, « vous »), the register of a base (`registerOf`), and the name ideas
// for the ↻ button. The quest log's naming modal (quest 0's fallback, renaming) uses the same
// local rules.
import { COLONY_NAME_MAX } from '@/content/quests';
import type { Loc } from '@/content/types';
import { locale, t } from '@/i18n/i18n';
import type { Sim } from '@/sim/state';
import { cleanName } from '@/sim/systems/quests';

/** Why a name was refused (each has its message: `intro.name.<why>`). */
export type NameRefusal = 'empty' | 'long' | 'taken' | 'reserved' | 'unavailable';

export type NameVerdict =
  | { readonly ok: true; readonly name: string }
  /** `clash`: the registered name it collides with (a sister claim), or the reserved one typed. */
  | { readonly ok: false; readonly why: NameRefusal; readonly clash?: Loc | string };

export interface NameRegister {
  /** Names already on the register: the sister claims', in both languages. */
  readonly taken: ReadonlyArray<Loc>;
  /**
   * The future server's say on a name that passed the local rules (other players' companies):
   * a refusal, or null when it has no objection. Absent today. A rejected promise reads as
   * « the register does not answer » (`unavailable`).
   */
  readonly remote?: (name: string) => Promise<NameVerdict | null>;
}

/** The register's comparison form: lower case, accents off, œ/æ spelt out, non-letters → one space. */
export function foldName(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** CrierBelt's and the world's own names: no company registers under them (compared folded). */
const RESERVED: readonly string[] = [
  'CrierBelt', 'Crier Belt', 'Criée', 'La Criée', 'Crier', 'The Crier', 'Crier Ring', 'Anneau', 'L’Anneau',
  'Anneau de la Criée', 'Ring', 'The Ring', 'Gazette', 'La Gazette', 'Gazette de la Criée', 'Crier Gazette',
  'Verrière', 'Ysmère', 'Ocelle', 'Cœur', 'Le Cœur', 'Heart', 'The Heart', 'Hearth', 'Concession sans nom', 'Unnamed claim',
];
const RESERVED_FOLDED = new Set(RESERVED.map(foldName));
/** The brand, wherever it appears in a name (« CrierBelt Mining » passes itself off as CrierBelt). */
const BRAND = 'crierbelt';

/** The local verdict, synchronous: length, then reserved names, then the sister claims. */
export function nameVerdict(raw: string, taken: ReadonlyArray<Loc>): NameVerdict {
  const name = cleanName(raw);
  const folded = name === null ? '' : foldName(name);
  if (name === null || folded === '') {
    // cleanName refuses both an empty and a long name: tell them apart for the message (its own
    // cleaning, measured the same way). A name with no letter or digit (« --- ») is no name either.
    const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    return { ok: false, why: [...s].length > COLONY_NAME_MAX ? 'long' : 'empty' };
  }
  if (RESERVED_FOLDED.has(folded) || folded.replace(/ /g, '').includes(BRAND)) return { ok: false, why: 'reserved', clash: name };
  for (const loc of taken) {
    if (foldName(loc.fr) === folded || foldName(loc.en) === folded) return { ok: false, why: 'taken', clash: loc };
  }
  return { ok: true, name };
}

/**
 * Is this name free to register? The seam for a server: the local rules first (instant), then
 * `reg.remote` if there is one. Resolves, never rejects.
 */
export async function checkName(raw: string, reg: NameRegister): Promise<NameVerdict> {
  const local = nameVerdict(raw, reg.taken);
  if (!local.ok || !reg.remote) return local;
  try {
    return (await reg.remote(local.name)) ?? local;
  } catch {
    return { ok: false, why: 'unavailable' };
  }
}

/** The register a base's name is checked against: its world's sister claims. */
export function registerOf(sim: Sim): NameRegister {
  return { taken: sim.market.snapshot().colonies.map((c) => c.name) };
}

/** A refusal in CrierBelt's words; `typed`: what the player typed (named back when nothing else is). */
export function refusalText(v: Extract<NameVerdict, { ok: false }>, typed: string): string {
  const clash = typeof v.clash === 'string' ? v.clash : v.clash ? v.clash[locale()] : typed.trim();
  switch (v.why) {
    case 'empty': return t('intro.name.empty');
    case 'long': return t('intro.name.long', { n: COLONY_NAME_MAX });
    case 'taken': return t('intro.name.taken', { name: clash });
    case 'reserved': return t('intro.name.reserved', { name: clash });
    case 'unavailable': return t('intro.name.unavailable');
    default: { const never: never = v.why; return never; }
  }
}

/** Name ideas for a new company (place-like names: the same in both languages). */
export const NAME_IDEAS: readonly string[] = [
  'Filon-Clair', 'Haute-Braise', 'Val-de-Cuivre', 'Roche-Fière', 'Belle-Coulée', 'Pierre-Haute',
  'Sables-d’Or', 'Vent-Clair', 'Mont-Ferré', 'Fonds-de-Verre', 'Trois-Cols', 'Bonne-Mine',
];

/** The k-th name idea that is free (wrapping around); a numbered fallback if none is. */
export function suggestName(k: number, taken: ReadonlyArray<Loc>): string {
  const n = NAME_IDEAS.length;
  for (let i = 0; i < n; i++) {
    const idea = NAME_IDEAS[(((k + i) % n) + n) % n]!;
    if (nameVerdict(idea, taken).ok) return idea;
  }
  return `Filon-${(k % 90) + 10}`;
}
