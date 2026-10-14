import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { testSim, testSource, drillToHearth, line } from './testkit';
import { serialize, deserialize } from './serialize';

describe('save / load', () => {
  it('load(save(sim)) preserves the state hash', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.place('router', 520, 520, 0);
    sim.run(1234);
    const data = JSON.parse(JSON.stringify(serialize(sim)));
    const back = deserialize(data, testSource());
    expect(back.hash()).toBe(sim.hash());
  });

  it('a skipped tutorial keeps its quest baselines through a save (the demo base)', () => {
    const sim = testSim();
    sim.skipTutorial();
    sim.run(30);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.quests.base).toEqual(sim.quests.base);
    expect(back.hash()).toBe(sim.hash());
  });

  it('a loaded colony continues exactly like the original', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.placeBelts('ribbon', line(520, 520, 1, 4));
    sim.run(900);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    sim.run(3000);
    back.run(3000);
    expect(back.hash()).toBe(sim.hash());
    expect(Array.from(back.stock)).toEqual(Array.from(sim.stock));
  });
});

describe('determinism guard', () => {
  it('engine sources never use Math.random, the clock or transcendental Math', () => {
    // The engine, the core helpers it imports, and the content tables it reads.
    const roots = ['src/sim', 'src/content', 'src/core/hash.ts', 'src/core/fixed.ts', 'src/core/noise.ts', 'src/core/rng.ts'];
    const files: string[] = [];
    const walk = (p: string): void => {
      if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f)); return; }
      if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.bench.ts') && !p.endsWith('testkit.ts')) files.push(p);
    };
    for (const r of roots) walk(r);
    const banned = /Math\.(random|sin|cos|tan|exp|log|log2|log10|pow|atan|atan2|asin|acos|hypot|sqrt|cbrt|sinh|cosh|tanh)\b|Date\.now|performance\.now|new Date\(/;
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return;
        const code = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        // `**` with a non-literal exponent (x ** 0.5, a ** b) is banned; `x ** 2` style literals are fine.
        if (banned.test(code) || /[\w)\]]\s*\*\*\s*[^\d\s]/.test(code)) offenders.push(`${f}:${i + 1}: ${t}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the market (floats allowed) never reads randomness or the clock', () => {
    const files: string[] = [];
    const walk = (p: string): void => {
      if (!existsSync(p)) return;
      if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f)); return; }
      if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    };
    walk('src/market');
    const offenders = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [l, i] as const)
      .filter(([l]) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /Math\.random|Date\.now|performance\.now|new Date\(/.test(l.replace(/\/\/.*$/, '')))
      .map(([l, i]) => `${f}:${i + 1}: ${l.trim()}`));
    expect(offenders).toEqual([]);
  });
});
