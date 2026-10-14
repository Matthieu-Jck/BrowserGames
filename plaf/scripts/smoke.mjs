// smoke.mjs — headless end-to-end smoke test: plays every level to completion
// by dragging the wooden bars with real pointer events along each level's
// stored solution, waits for the live water sim to turn the wheel(s), then
// advances. Checks localStorage progress persistence. Fails on any
// console/page error.
//
// Usage: node scripts/smoke.mjs   (game served at $URL, default :8742)
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

const URL = process.env.URL ?? 'http://localhost:8742';
const errors = [];
let failed = false;

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const step = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const levels = await page.evaluate(() =>
  LEVELS.map(l => ({ name: l.name, map: l.map, solution: l.solution }))
);

// reference cell (topmost-leftmost) of each bar, parsed from the ASCII map
function barRefs(map) {
  const refs = new Map();
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const ch = map[y][x];
      if (/[a-z]/.test(ch) && ch !== 'w' && !refs.has(ch)) refs.set(ch, { x, y });
    }
  }
  return refs;
}

async function cellCenter(li, x, y) {
  return page.evaluate(([li, x, y]) => {
    const r = document.getElementById('game').getBoundingClientRect();
    const cols = LEVELS[li].map[0].length, rows = LEVELS[li].map.length;
    return {
      cx: r.left + (x + 0.5) * r.width / cols,
      cy: r.top + (y + 0.5) * r.height / rows,
    };
  }, [li, x, y]);
}

async function dragBar(li, from, to) {
  const a = await cellCenter(li, from.x, from.y);
  const b = await cellCenter(li, to.x, to.y);
  await page.mouse.move(a.cx, a.cy);
  await page.mouse.down();
  await page.mouse.move(b.cx, b.cy, { steps: 12 });
  await page.mouse.up();
}

for (let li = 0; li < levels.length; li++) {
  const L = levels[li];
  const refs = barRefs(L.map);

  // wait for the pool to settle, as a player would
  await page.waitForTimeout(600);

  for (const mv of L.solution) {
    const ref = refs.get(mv.bar);
    const target = { x: ref.x + (mv.dx || 0), y: ref.y + (mv.dy || 0) };
    await dragBar(li, ref, target);
    refs.set(mv.bar, target);
    await page.waitForTimeout(700); // let water flow between moves
  }

  let winShown = true;
  try {
    await page.waitForSelector('#win-overlay:not(.hidden)', { timeout: 45000 });
  } catch {
    winShown = false;
  }
  step(`level ${li + 1} (${L.name}) solved via UI`, winShown);
  if (!winShown) break;

  const last = li === levels.length - 1;
  const title = await page.textContent('#win-title');
  if (last) {
    const nextHidden = await page.$eval('#btn-next', b => b.style.display === 'none');
    step('final level shows Great Machine banner, no Next button',
      nextHidden && /Great Machine/.test(title), title.trim());
  } else {
    await page.click('#btn-next');
    await page.waitForSelector('#win-overlay.hidden', { state: 'attached', timeout: 3000 });
    await page.waitForTimeout(200);
  }
}

// progress must survive a reload
await page.reload({ waitUntil: 'networkidle' });
const unlocked = await page.evaluate(() => localStorage.getItem('waterwheel.unlocked'));
const enabledButtons = await page.$$eval('#level-bar button', bs => bs.filter(b => !b.disabled).length);
step('progress persists after reload', unlocked === '8' && enabledButtons === 8,
  `unlocked=${unlocked}, enabled level buttons=${enabledButtons}`);

await browser.close();

if (errors.length) {
  console.log('\nBrowser errors:');
  for (const e of errors) console.log('  ' + e);
  failed = true;
}
console.log(failed ? '\nSMOKE FAILED' : '\nAll smoke checks passed.');
process.exit(failed ? 1 : 0);
