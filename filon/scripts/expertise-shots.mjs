// expertise-shots.mjs — the expertises (D93) for visual review: the window on a young base (the
// Archive not mounted yet), then on the late debug base (two expertises in place), a réorientation
// armed and made (its 24 h bar), the window in English, the Core's Archive in iso and in plan (a
// real click on it opens the window), the Core's inspector and the HUD's chip, the tech tree's
// Tier 2 head. Usage: a server (the dev one on :5183, or a preview build: URL=…), then
// `node scripts/expertise-shots.mjs` → scripts/expertise-*.png (gitignored).
// Env: URL, CHROME.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5183';
const shot = (name) => fileURLToPath(new globalThis.URL(`./expertise-${name}.png`, import.meta.url));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.log('pageerror:', err.message); });
await page.goto(`${URL}/?debug`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.FL && window.FL.ready(), undefined, { timeout: 20000 });
await page.waitForFunction(() => !document.querySelector('[data-screen="boot"]'), undefined, { timeout: 15000 });
await page.evaluate(() => { window.FL.intro?.(false); window.FL.menu?.(false); if (window.FL.app.guide) window.FL.app.guide.enabled = false; window.FL.dayPhase('noon'); });
await page.waitForTimeout(500);
const settle = async (ms = 1200) => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.FL.perf().chunksMissing === 0, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const check = (ok, what) => { if (!ok) { console.log(`✗ ${what}`); process.exitCode = 1; } else console.log(`✓ ${what}`); };

// ── a young base: the Archive is not mounted, the window says where it comes from ──
await page.evaluate(() => window.FL.open('expertise'));
await page.waitForTimeout(400);
await page.screenshot({ path: shot('locked') });
check(await page.evaluate(() => document.querySelector('.expertise')?.hasAttribute('data-locked')), 'young base: the window is locked (the Core under level 3)');
await page.evaluate(() => window.FL.close());

// ── the late debug base: two expertises chosen by its build ──
const r = await page.evaluate(() => window.FL.debugSave('late'));
console.log(`late base: ${r.ok ? `${r.ms} ms` : 'refused'}`);
await page.evaluate(() => { window.FL.menu(false); window.FL.close(); window.FL.dayPhase('noon'); });
await page.evaluate(() => window.FL.tick(600));
const x = await page.evaluate(() => window.FL.expertise());
console.log('expertise:', JSON.stringify({ ranks: x.ranks, slots: x.slots.map((s) => s && s.id), tierTwo: x.tierTwo, archive: x.archive }));
check(x.slots.every((s) => s && s.on) && x.tierTwo, 'late base: two expertises in place, Tier 2 open');

await page.evaluate(() => window.FL.open('expertise'));
await page.waitForTimeout(500);
await page.screenshot({ path: shot('window') });
// A réorientation: arm it on an earned card, then replace the first slot.
const arm = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.ex-act[data-kind="reorient"]')].find((n) => !n.disabled && !n.hidden);
  if (!b) return null;
  b.click();
  return b.getAttribute('data-ex-act');
});
await page.waitForTimeout(400);
check(!!arm && await page.evaluate(() => document.querySelector('.expertise')?.hasAttribute('data-arming')), `a réorientation armed (${arm})`);
await page.screenshot({ path: shot('arming') });
await page.evaluate(() => document.querySelector('[data-ex-replace="0"]')?.click());
await page.waitForTimeout(500);
const after = await page.evaluate(() => window.FL.expertise());
check(after.slots[0]?.id === arm && after.slots[0]?.on === false, 'slot 1 reoriented: 24 h before it is in place');
await page.screenshot({ path: shot('coming') });
await page.evaluate(() => window.FL.setLocale('en'));
await page.waitForTimeout(500);
await page.screenshot({ path: shot('window-en') });
await page.evaluate(() => window.FL.setLocale('fr'));
await page.evaluate(() => window.FL.close());

// ── the Archive on the Core: iso and plan; a real click on it opens the window ──
await page.evaluate(() => { window.FL.view('iso'); window.FL.lookAt(512, 511, 2.6); });
await settle();
const hearth = await page.evaluate(() => window.FL.app.sim.hearthId);
const corner = await page.evaluate(() => { const e = window.FL.app.sim.ents.get(window.FL.app.sim.hearthId); return [e.x, e.y]; });
await page.screenshot({ path: shot('archive-iso'), clip: await (async () => { const [sx, sy] = await page.evaluate(() => window.FL.tileToScreen(512, 512)); return { x: Math.max(0, sx - 340), y: Math.max(0, sy - 300), width: 680, height: 480 }; })() });
// The drum stands on the Core's south-west corner tile (0, 4): its centre a level up.
const at = await page.evaluate(([cx, cy]) => {
  const p = window.FL.app.picker, s = window.FL.app.camera.state;
  const [x0, y0] = p.tileToScreen(cx + 0.06, cy + 3.94); // its centre (0.56, 4.44): a tile's centre is +0.5
  return [x0, y0 - 16 * s.zoom];
}, corner);
await page.mouse.click(at[0], at[1]);
await page.waitForTimeout(500);
check(await page.evaluate(() => window.FL.screen() === 'expertise'), 'a click on the Archive (iso) opens the Expertise window');
await page.evaluate(() => window.FL.close());
await page.evaluate(() => { window.FL.view('plan'); });
await page.waitForFunction(() => window.FL.view().t === 1, undefined, { timeout: 4000 }).catch(() => {});
await settle(600);
const [px, py] = await page.evaluate(([cx, cy]) => window.FL.tileToScreen(cx, cy + 4), corner);
await page.screenshot({ path: shot('archive-plan'), clip: { x: Math.max(0, px - 300), y: Math.max(0, py - 360), width: 600, height: 440 } });
await page.mouse.click(px, py);
await page.waitForTimeout(500);
check(await page.evaluate(() => window.FL.screen() === 'expertise'), 'a click on the Archive (plan) opens the Expertise window');
await page.evaluate(() => { window.FL.close(); window.FL.view('iso'); });

// ── the Core's inspector and the HUD's chip ──
await page.evaluate((id) => window.FL.selected(id), hearth);
await page.waitForTimeout(600);
await page.locator('.inspector').first().screenshot({ path: shot('inspector') }).catch(async () => { await page.screenshot({ path: shot('inspector') }); });
await page.evaluate(() => window.FL.selected(0));
await page.locator('.hud').screenshot({ path: shot('hud') });
check(await page.evaluate(() => !document.querySelector('[data-hud-expertise]')?.hidden), 'the HUD shows the Expertise chip');
await page.evaluate(() => window.FL.open('research'));
await page.waitForTimeout(800);
// The Synthesis, the Tier 2 head's gate: « et deux expertises » beside it.
await page.evaluate(() => document.querySelector('.rs-card[data-id="tr_synth"]')?.scrollIntoView({ block: 'center', inline: 'center' }));
await page.evaluate(() => document.querySelector('.rs-card[data-id="tr_synth"]')?.click());
await page.waitForTimeout(900);
await page.screenshot({ path: shot('tree') });
await page.evaluate(() => window.FL.close());

check(errors.length === 0, `no page errors (${errors.length})`);
await browser.close();
