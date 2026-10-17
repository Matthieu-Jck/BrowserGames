// sound-levels.mjs — renders every building signature (D120) and every cue through the real
// SoundEngine in an OfflineAudioContext (headless Chrome), alone, at full sliders, through the
// whole master chain, and measures each: peak (dBFS), NaN samples, clipped samples, and how long
// it stays above −40 dB of its peak. Fails when a sound writes a NaN, clips, peaks over −6 dBFS,
// or strays more than 1.5 dB from the peak recorded in `SIGNATURES[…].peakDb` / `CUES[…].peakDb`.
// Each signature is rendered over three chords (the tonal parts follow the score) and the
// loudest kept.
//
// It needs a dev server (it imports the TypeScript modules): `npx vite --port 5197 --strictPort`,
// then `URL=http://localhost:5197 node scripts/sound-levels.mjs`. `--json` prints the raw numbers;
// `--wav <file>` also writes every signature in turn (built, then picked) at the default sliders,
// to listen to.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5183';
const JSON_OUT = process.argv.includes('--json');
const WAV = process.argv.includes('--wav') ? process.argv[process.argv.indexOf('--wav') + 1] : null;

try { await fetch(URL); } catch {
  console.log(`✗ no dev server at ${URL}`);
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// A module URL of the dev server: no HMR client, nothing else loaded.
await page.goto(`${URL}/src/audio/levels.ts`);

const res = await page.evaluate(async () => {
  const { SoundEngine } = await import('/src/audio/engine.ts');
  const { SIGNATURES } = await import('/src/audio/signatures.ts');
  const { CUES } = await import('/src/audio/cues.ts');
  const SR = 48000, AT = 0.3;
  const CHORDS = [[2, 6, 9], [4, 7, 11], [7, 11, 2, 6]];
  const measure = (buf) => {
    let peak = 0, nan = 0, clip = 0, last = 0;
    const chans = [buf.getChannelData(0), buf.getChannelData(1)];
    for (const x of chans) for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
    }
    const floor = peak * 0.01; // −40 dB under its own peak
    for (const x of chans) for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > floor) { last = Math.max(last, i); break; }
    return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, nan, clip, len: last / SR - AT };
  };
  const render = async (play, chord) => {
    const ctx = new OfflineAudioContext(2, SR * 2.5, SR);
    const e = new SoundEngine(ctx, { seed: 7, volumes: { master: 1, music: 1, sfx: 1 }, music: false, ambience: false });
    e.start(0);
    if (chord) e.score.chord = { ...(e.score.chord ?? {}), pcs: chord };
    play(e);
    return measure(await ctx.startRendering());
  };
  const loudest = (ms) => ms.reduce((a, b) => ({ peakDb: Math.max(a.peakDb, b.peakDb), nan: a.nan + b.nan, clip: a.clip + b.clip, len: Math.max(a.len, b.len) }));
  const sigs = [];
  for (const s of Object.keys(SIGNATURES)) {
    for (const [vi, variant] of ['build', 'pick'].entries()) {
      const ms = [];
      for (const c of CHORDS) ms.push(await render((e) => e.playSignature(s, variant, 1, 0, AT), c));
      sigs.push({ name: `${s}.${variant}`, recorded: SIGNATURES[s].peakDb[vi], ...loudest(ms) });
    }
  }
  const cues = [];
  // A ribbon run at its cap (its peak was recorded for a long drag).
  for (const c of Object.keys(CUES)) cues.push({ name: c, recorded: CUES[c].peakDb, ...(await render((e) => e.play(c, c === 'ribbon' ? 14 : 1, AT), CHORDS[0])) });
  return { sigs, cues };
});

if (WAV) {
  // Every signature in turn: built, then picked 0.75 s later, 1.7 s apart, at the default sliders.
  const { rate, left, right, names } = await page.evaluate(async () => {
    const { SoundEngine } = await import('/src/audio/engine.ts');
    const { SIGNATURES } = await import('/src/audio/signatures.ts');
    const { DEFAULT_VOLUMES } = await import('/src/audio/levels.ts');
    const SR = 48000, names = Object.keys(SIGNATURES);
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * (0.5 + 1.7 * names.length + 1)), SR);
    const e = new SoundEngine(ctx, { seed: 7, volumes: DEFAULT_VOLUMES, music: false, ambience: false });
    e.start(0);
    names.forEach((s, i) => { e.playSignature(s, 'build', 1, 0, 0.5 + 1.7 * i); e.playSignature(s, 'pick', 1, 0, 1.25 + 1.7 * i); });
    const buf = await ctx.startRendering();
    const b64 = (x) => { const u = new Uint8Array(x.buffer); let str = ''; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(str); };
    return { rate: SR, left: b64(buf.getChannelData(0)), right: b64(buf.getChannelData(1)), names };
  });
  const ch = [left, right].map((b) => new Float32Array(new Uint8Array(Buffer.from(b, 'base64')).buffer));
  const n = ch[0].length, data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), 44 + i * 4 + c * 2);
  writeFileSync(WAV, data);
  console.log(`wrote ${WAV}: ${names.map((s, i) => `${(0.5 + 1.7 * i).toFixed(1)} s ${s}`).join(' · ')}`);
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }
const bad = [...errors];
const row = (r, tol) => {
  const off = r.peakDb - r.recorded;
  const flags = [];
  if (r.nan) flags.push(`${r.nan} NaN`);
  if (r.clip) flags.push(`${r.clip} clipped`);
  if (r.peakDb > -6) flags.push('over −6 dBFS');
  if (Math.abs(off) > tol) flags.push(`recorded ${r.recorded}`);
  if (flags.length) bad.push(`${r.name}: ${flags.join(', ')}`);
  console.log(`${flags.length ? '✗' : '✓'} ${r.name.padEnd(16)} ${r.peakDb.toFixed(1).padStart(6)} dBFS  ${(r.len * 1000).toFixed(0).padStart(5)} ms  (recorded ${r.recorded})${flags.length ? '  ← ' + flags.join(', ') : ''}`);
};
console.log('— building signatures (D120), full sliders —');
for (const r of res.sigs) row(r, 1.5);
console.log('— cues, full sliders —');
for (const r of res.cues) row(r, 1.5);
if (bad.length) { console.log(`\n✗ ${bad.length} problem(s)`); process.exit(1); }
console.log('\n✓ every sound renders clean and as recorded');
