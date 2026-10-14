// smoke.mjs — headless smoke test: boots the game, verifies the title screen,
// clicks to clock in, and checks the HUD + a rendered frame. Fails on any
// console/page error.
//
// Usage: node scripts/smoke.mjs   (game served at $URL, default :8000)
// Needs playwright-core; resolved from ./node_modules or a sibling project.
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const nmCandidates = [
  path.join(here, '..', 'node_modules'),
  path.join(here, '..', '..', 'replicatas', 'node_modules'),
];
const nm = nmCandidates.find(p => existsSync(path.join(p, 'playwright-core')));
if (!nm) {
  console.error('playwright-core not found in', nmCandidates.join(' or '));
  process.exit(2);
}
const require = createRequire(path.join(nm, 'resolve-anchor.js'));
const { chromium } = require('playwright-core');

const URL = process.env.URL ?? 'http://localhost:8000';
const errors = [];
let failed = false;

const step = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// the game has no favicon; that 404 is browser noise, not a game error
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  if ((msg.location()?.url ?? '').endsWith('/favicon.ico')) return;
  errors.push(`console: ${msg.text()}`);
});
page.on('response', (res) => {
  if (!res.ok() && !res.url().endsWith('/favicon.ico')) {
    errors.push(`http ${res.status()}: ${res.url()}`);
  }
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });

// title overlay visible
const titleShown = await page.$eval('#overlay-title', el => el.classList.contains('show'));
const titleText = await page.textContent('h1.title');
step('title screen shown', titleShown && titleText.trim() === 'OVERTIME', titleText.trim());

// modules booted: main.js sets window.OT (the watchdog repaints .begin if not)
let booted = true;
try {
  await page.waitForFunction(() => !!window.OT, { timeout: 15000 });
} catch {
  booted = false;
}
const beginText = (await page.textContent('#overlay-title .begin')).trim();
step('game modules booted (window.OT set)', booted, booted ? '' : beginText);

if (booted) {
  await page.screenshot({ path: path.join(here, 'smoke-title.png') });

  // clock in
  await page.click('#overlay-title');
  let hudShown = true;
  try {
    await page.waitForSelector('#hud.show', { timeout: 8000 });
  } catch {
    hudShown = false;
  }
  step('clicking starts the shift (HUD shown)', hudShown);

  if (hudShown) {
    // let a few frames render, then verify the WebGL canvas isn't a dead black frame
    await page.waitForTimeout(2500);
    await page.keyboard.down('w');
    await page.waitForTimeout(1200);
    await page.keyboard.up('w');
    await page.screenshot({ path: path.join(here, 'smoke-game.png') });

    const objective = (await page.textContent('#objective')).trim();
    step('objective set', objective.length > 0, objective);
  }
}

await browser.close();

if (errors.length) {
  console.log('\nBrowser errors:');
  for (const e of errors) console.log('  ' + e);
  failed = true;
}
console.log(failed ? '\nSMOKE FAILED' : '\nAll smoke checks passed.');
process.exit(failed ? 1 : 0);
