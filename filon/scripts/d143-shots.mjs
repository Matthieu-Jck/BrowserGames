// d143-shots.mjs — D143's captures through window.FL: « Tenir la nuit » current with its hint asked
// (the wind alone since the coal generator left the game), the night notice, the Électricité view on
// the tutorial debug base, and the build bar's Energy tab on the late debug base (no coal generator).
// Usage: a dev or preview server, then `URL=http://127.0.0.1:<port> node scripts/d143-shots.mjs`
// → scripts/d143-*.png (gitignored). SHOT_LOCALE=en-US for the English ones.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new globalThis.URL(`./${name}`, import.meta.url)); // (URL is shadowed below)
const URL = process.env.URL ?? 'http://localhost:5183';
const LOCALE = process.env.SHOT_LOCALE ?? 'fr-FR';
const tag = LOCALE.startsWith('fr') ? '' : `-${LOCALE.slice(0, 2)}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: LOCALE });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.goto(`${URL}/?seed=1&debug&nomenu`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 15000 });
const FL = (fn, arg) => page.evaluate(fn, arg);
const settle = async (ms = 1500) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const take = async (name) => { await page.screenshot({ path: shot(name) }); console.log(`✓ ${name}`); };

// 1 · « Tenir la nuit »: the smelter level, « La fonderie » forced through; the goal current, its hint asked.
// That level's one drill lets the Core's isotope core hold the night (the goal would pass at once), so a
// rig first: a server (400 kW day and night) wired to the Core, the load three drills and a smelter's
// night would put on it.
let r = await FL(() => window.FL.debugSave('smelter'));
if (!r?.ok) throw new Error(`smelter level: ${JSON.stringify(r)}`);
const rig = await FL(() => {
  const sim = window.FL.app.sim;
  sim.done.add('an_servers');
  sim.rebuildDerived();
  sim.grant('ceramic', 40); sim.grant('circuit', 40); sim.grant('cable', 40); sim.grant('steel', 40); sim.grant('oscillator', 10);
  for (let d = 7; d < 16; d++) for (const [dx, dy] of [[d, 3], [-d, 3], [3, d], [-3, d]]) {
    const p = window.FL.place('server', 512 + dx, 512 + dy, 0);
    if (!p.ok) continue;
    window.FL.powerTo(p.id);
    sim.ensureCompiled();
    if (sim.graph.netOfEnt.get(p.id) === sim.graph.netOfEnt.get(sim.hearthId)) return p.id;
    window.FL.app.sim.remove(512 + dx, 512 + dy); // not on the Core's grid: elsewhere
  }
  return window.FL.place('server', 519, 515, 0).reason;
});
if (typeof rig !== 'number') throw new Error(`no room for the rig: ${rig}`);
// The server stands once built (a minute or so): until then it draws nothing and the night would hold.
await FL(() => { window.FL.menu(false); window.FL.pause(); window.FL.tick(1200); });
await FL(() => { window.FL.dayPhase('noon'); window.FL.app.guide.enabled = true; window.FL.completeQuest('bloom_kiln'); });
await page.waitForSelector('[data-quest-hint]:not([disabled])', { timeout: 4000 });
const q = await FL(() => window.FL.quests());
if (q.current !== 'first_wind') throw new Error(`current quest ${q.current}`);
await page.click('[data-quest-hint]');
await page.waitForFunction(() => { const d = window.FL.quests().guide; return d.hint && d.at !== 'hidden'; }, undefined, { timeout: 3000 }).catch(() => {});
await settle();
await take(`d143-night-quest${tag}.png`);
await page.click('[data-quest-hint]');

// 2 · The night notice, on the same base.
await FL(() => window.FL.nightNotice(true));
await settle(600);
await take(`d143-night-notice${tag}.png`);
await page.click('[data-night-ok]');
await FL(() => { window.FL.app.guide.enabled = false; });

// 3 · The Électricité view on the tutorial level by night (its boiler and turbines carry it, D143).
r = await FL(() => window.FL.debugSave('tutorial'));
if (!r?.ok) throw new Error(`tutorial level: ${JSON.stringify(r)}`);
await FL(() => { window.FL.menu(false); window.FL.pause(); window.FL.dayPhase('night'); window.FL.mapView('power'); window.FL.lookAt(512, 506, 0.75); });
await settle(2000);
await take(`d143-power-view${tag}.png`);
await FL(() => { window.FL.mapView('normal'); window.FL.dayPhase(null); });

// 4 · The build bar's Energy tab on the late level (everything unlocked): no coal generator.
r = await FL(() => window.FL.debugSave('late'));
if (!r?.ok) throw new Error(`late level: ${JSON.stringify(r)}`);
await FL(() => { window.FL.menu(false); window.FL.pause(); window.FL.dayPhase('noon'); window.FL.lookAt(512, 506, 0.9); window.FL.category('energy'); });
await settle(1200);
const slots = await FL(() => [...document.querySelectorAll('.bb-slot[data-def]')].map((e) => e.getAttribute('data-def')));
console.log(`  energy slots: ${slots.join(', ')}`);
if (slots.includes('brazier')) throw new Error('a coal generator in the build bar');
await take(`d143-energy-bar${tag}.png`);
await FL(() => { window.FL.category(null); window.FL.dayPhase(null); window.FL.debugSave(null); });

await browser.close();
