// architecture.test.ts — the layering of src/, enforced (see ARCHITECTURE.md). Each top-level
// folder is a layer that may import only from the layers listed for it; the shell (src/app,
// main.ts, debug.ts, settings.ts) may import anything and nothing imports the shell. Pixi is
// confined to src/render, Web Audio to src/audio (which only the shell imports: no layer lists
// it). Type-only imports (`import type …`) are allowed one step "up" where noted: they vanish at
// runtime and keep data shapes in the module that produces them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname);

/** Runtime imports allowed per layer (its own folder is always allowed). */
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  content: ['core'],
  i18n: ['core', 'content'],
  market: ['core', 'content'],
  sim: ['core', 'content', 'market'],
  persist: ['core', 'content', 'market', 'sim'],
  audio: ['core', 'content'],
  render: ['core', 'content', 'sim'],
  input: ['core', 'content', 'sim', 'render'],
  ui: ['core', 'content', 'sim', 'market', 'i18n', 'render'],
  app: ['*'],
};

/** Extra layers a layer may import TYPES from (`import type`). */
const TYPES_FROM: Record<string, readonly string[]> = {
  render: ['input'],
  ui: ['input'],
};

/** Inside render, the DOM UI may only reach the art kit and pure geometry (no scene graph). */
const UI_RENDER_OK = /^render\/(art\/|iso$|relief$|projection$)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(n) && !/\.(test|bench)\.ts$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });
}

/** The layer of a path under src/ ('app' for the shell files at the root). */
function layerOf(rel: string): string {
  const [head, ...rest] = rel.split('/');
  return rest.length ? head! : 'app';
}

interface Imp { spec: string; target: string | null; typeOnly: boolean }

function importsOf(file: string): Imp[] {
  const src = readFileSync(file, 'utf8');
  const out: Imp[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    const spec = m[3]!;
    let target: string | null = null;
    if (spec.startsWith('@/')) target = spec.slice(2);
    else if (spec.startsWith('.')) target = relative(SRC, resolve(dirname(file), spec)).replace(/\\/g, '/');
    out.push({ spec, target: target?.replace(/\.ts$/, '') ?? null, typeOnly: !!m[2] });
  }
  return out;
}

describe('architecture', () => {
  const all = files(SRC).map((f) => ({ file: f, rel: relative(SRC, f).replace(/\\/g, '/') }));

  it('each layer imports only from the layers below it', () => {
    const bad: string[] = [];
    for (const { file, rel } of all) {
      const from = layerOf(rel);
      const ok = ALLOWED[from];
      expect(ok, `unknown layer "${from}" (${rel}): add it to ALLOWED and ARCHITECTURE.md`).toBeDefined();
      if (ok!.includes('*')) continue;
      for (const imp of importsOf(file)) {
        if (!imp.target) continue;
        const to = layerOf(imp.target);
        if (to === from) continue;
        if (ok!.includes(to) || (imp.typeOnly && TYPES_FROM[from]?.includes(to))) {
          if (from === 'ui' && to === 'render' && !UI_RENDER_OK.test(imp.target)) bad.push(`${rel} → ${imp.spec} (ui may use render's art kit and geometry only)`);
          continue;
        }
        bad.push(`${rel} → ${imp.spec}${imp.typeOnly ? ' (type)' : ''}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('nothing imports the shell (src/app, main, debug, settings) but the shell', () => {
    const bad = all.filter(({ rel }) => layerOf(rel) !== 'app').flatMap(({ file, rel }) =>
      importsOf(file).filter((i) => i.target && layerOf(i.target) === 'app').map((i) => `${rel} → ${i.spec}`));
    expect(bad).toEqual([]);
  });

  it('pixi.js is only imported under src/render', () => {
    const bad = all.filter(({ file, rel }) => !rel.startsWith('render/') && importsOf(file).some((i) => i.spec === 'pixi.js')).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it('Web Audio is only used under src/audio (the shell drives it through audio/sound.ts)', () => {
    const webAudio = /\bnew\s+(?:Offline|webkit)?AudioContext\b|\.create(?:Oscillator|Gain|BufferSource|BiquadFilter|Convolver|DynamicsCompressor|StereoPanner|WaveShaper|PeriodicWave)\s*\(/;
    const bad = all.filter(({ file, rel }) => !rel.startsWith('audio/') && webAudio.test(readFileSync(file, 'utf8'))).map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});
