// tokens-free.test.ts — research is billed AI tokens only once the claim can place servers (D105):
// the first nodes run on data alone; a project started after the server's unlock pays its tokens.
import { describe, it, expect } from 'vitest';
import { buildingDef, buildingIdx } from '@/content/registry';
import { foundScenario } from '../scenarios';
import { WORLD_EPOCH0 } from '../constants';
import { tokensBilled } from '../systems/research';

describe('research tokens before servers (D105)', () => {
  it('the tutorial base runs its first research without tokens; the late base, servers in hand, pays them', () => {
    const tut = foundScenario('tutorial', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;
    expect(tokensBilled(tut)).toBe(false);
    for (const p of tut.projects) expect(p.tokens, p.id).toBe(0);
    const late = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;
    expect(late.done.has(buildingDef(buildingIdx('server')).unlock)).toBe(true);
    expect(tokensBilled(late)).toBe(true);
    expect(late.projects.some((p) => (p.tokens ?? 0) > 0), 'late: a project pays tokens').toBe(true);
  }, 60_000);
});
