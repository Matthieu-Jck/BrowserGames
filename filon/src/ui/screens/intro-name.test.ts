// intro-name.test.ts — the company name's rules (D31): length, the other claims (pinned and
// generated, both languages), reserved names, the comparison (case, accents, dashes), the
// async seam for a server, and the ↻ ideas.
import { describe, expect, it } from 'vitest';
import { PINNED_COLONIES } from '@/content/colonies';
import { COLONY_NAME_MAX } from '@/content/quests';
import { WORLD_SEED } from '@/content/world';
import { makeColonies } from '@/market/colonies';
import { NAME_IDEAS, checkName, foldName, nameVerdict, suggestName, type NameVerdict } from './intro-name';

const taken = makeColonies(WORLD_SEED).map((c) => c.name);
const why = (v: NameVerdict): string => (v.ok ? 'ok' : v.why);

describe('company name', () => {
  it('folds case, accents, œ and separators the way a register compares', () => {
    expect(foldName('Port-Écume')).toBe('port ecume');
    expect(foldName('  PORT   écume!! ')).toBe('port ecume');
    expect(foldName('Sables-d’Or')).toBe('sables d or');
    expect(foldName('Cœur')).toBe('coeur');
    expect(foldName('---')).toBe('');
  });

  it('keeps the cleaned name, and refuses empty or too long ones', () => {
    expect(nameVerdict('  Filon-Clair  ', taken)).toEqual({ ok: true, name: 'Filon-Clair' });
    expect(nameVerdict('Mines   du  Sud', taken)).toEqual({ ok: true, name: 'Mines du Sud' });
    expect(why(nameVerdict('', taken))).toBe('empty');
    expect(why(nameVerdict('   \n ', taken))).toBe('empty');
    expect(why(nameVerdict('— · —', taken))).toBe('empty');
    expect(why(nameVerdict('x'.repeat(COLONY_NAME_MAX), taken))).toBe('ok');
    expect(why(nameVerdict('x'.repeat(COLONY_NAME_MAX + 1), taken))).toBe('long');
  });

  it('refuses another claim’s name in either language, whatever the case, accents or dashes', () => {
    for (const p of PINNED_COLONIES) {
      expect(why(nameVerdict(p.name.fr, taken)), p.name.fr).toBe('taken');
      expect(why(nameVerdict(p.name.en, taken)), p.name.en).toBe('taken');
    }
    expect(why(nameVerdict('port ecume', taken))).toBe('taken');
    expect(why(nameVerdict('SEPT CORNES', taken))).toBe('taken');
    expect(why(nameVerdict('foam-harbor', taken))).toBe('taken');
    // The generated ones too (the market draws them from the world seed).
    const drawn = makeColonies(WORLD_SEED).filter((c) => !PINNED_COLONIES.some((p) => p.key === c.key));
    expect(drawn.length).toBeGreaterThan(30);
    for (const c of drawn) expect(why(nameVerdict(c.name.fr.toUpperCase(), taken)), c.name.fr).toBe('taken');
    const v = nameVerdict('Hameau Lilas', taken);
    expect(v.ok ? null : v.clash).toEqual(PINNED_COLONIES.find((p) => p.key === 'hameau_lilas')!.name);
  });

  it('refuses CrierBelt’s and the world’s own names, and anything posing as CrierBelt', () => {
    for (const n of ['CrierBelt', 'crier belt', 'La Criée', 'the ring', 'Verrière', 'YSMERE', 'Le Cœur', 'Concession sans nom', 'Unnamed Claim']) {
      expect(why(nameVerdict(n, taken)), n).toBe('reserved');
    }
    expect(why(nameVerdict('CrierBelt Mining', taken))).toBe('reserved');
    expect(why(nameVerdict('Les Mines de Verrière', taken))).toBe('ok');
    expect(why(nameVerdict('Port-Écume du Sud', taken))).toBe('ok');
  });

  it('checks through a promise, asking the server only once the local rules pass', async () => {
    let asked = 0;
    const remote = async (name: string): Promise<NameVerdict | null> => {
      asked++;
      return name === 'Prise' ? { ok: false, why: 'taken', clash: name } : null;
    };
    expect(await checkName('Filon-Clair', { taken })).toEqual({ ok: true, name: 'Filon-Clair' });
    expect(why(await checkName('Port-Écume', { taken, remote }))).toBe('taken');
    expect(asked).toBe(0);
    expect(await checkName(' Libre ', { taken, remote })).toEqual({ ok: true, name: 'Libre' });
    expect(why(await checkName('Prise', { taken, remote }))).toBe('taken');
    expect(asked).toBe(2);
    expect(why(await checkName('Libre', { taken, remote: () => Promise.reject(new Error('offline')) }))).toBe('unavailable');
  });

  it('suggests only free names', () => {
    for (let k = 0; k < NAME_IDEAS.length * 2; k++) expect(nameVerdict(suggestName(k, taken), taken).ok).toBe(true);
    // Even when an idea is taken, the next free one comes instead.
    const blocked = [{ fr: NAME_IDEAS[0]!, en: NAME_IDEAS[0]! }];
    expect(suggestName(0, blocked)).toBe(NAME_IDEAS[1]);
  });
});
