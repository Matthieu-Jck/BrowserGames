// pacing-report.mjs — the pacing bot's raw runs (D146, src/sim/pacing) as markdown tables and
// sparklines: the milestones by land, the purse over the hours, every night, the waits, the Core's
// stock and the production rates at each hour's end, the lab's idle minutes, what was bought.
//
//   node scripts/pacing-report.mjs [file] [set] [before-set]
//
// `file` holds `{ sets: { <name>: PacingRun[] } }` (default scripts/pacing-d146.json, D146's
// measurements; `PACING_OUT=… npx vitest run src/sim/pacing` writes the sets `hints` and `nohints`).
// `set` is the one reported (default `after-hints`, else the first); `before-set`, when given (default
// `before-hints` when it exists), shows each milestone as « before → now ».
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('./pacing-d146.json', import.meta.url).pathname;
const { sets } = JSON.parse(readFileSync(file, 'utf8'));
const names = Object.keys(sets);
const setName = process.argv[3] ?? (sets['after-hints'] ? 'after-hints' : names[0]);
const beforeName = process.argv[4] ?? (sets['before-hints'] && setName !== 'before-hints' ? 'before-hints' : null);
const runs = sets[setName], before = beforeName ? sets[beforeName] : null;
const lands = runs.map((r) => r.land);
const out = [];
const p = (s = '') => out.push(s);
const fmt = (v) => (v === undefined || v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const pair = (b, a) => (b === undefined && a === undefined ? '—' : before ? `${fmt(b)} → **${fmt(a)}**` : fmt(a));

// ── milestones ──
const QUESTS = [
  ['claim', 'Ta concession'], ['first_strike', '1 Premier coup de pioche'], ['bloom_kiln', '2 La fonderie'], ['first_wind', '3 Tenir la nuit'],
  ['glassworks', '4 La verrerie'], ['steam_power', '5 La vapeur'], ['crier_trade', '6 La Criée'], ['slag', '7 Les scories'],
  ['core_upgrade', '8 Le Cœur grandit'], ['field_journal', '9 Le laboratoire'], ['wall_quartz', '10 Le quartz de la paroi'], ['synth_parts', '11 Les pièces de la Synthèse'],
];
const OTHER = [
  ['firstDrill', 'first drill'], ['firstPost', 'first trade post'], ['firstSale', 'first sale'], ['core2', 'Core level 2'], ['lab', 'research lab placed'],
  ['cat:t1_energy', 'Tier 1 · Energy done'], ['cat:t1_extraction', 'Tier 1 · Extraction done'], ['cat:t1_commerce', 'Tier 1 · Commerce done'], ['cat:t1_logistics', 'Tier 1 · Logistics done'],
  ['cat:t1_workshop', 'Tier 1 · Workshop done'], ['cat:t1_foundry', 'Tier 1 · Foundry done'], ['tier1', 'Tier 1 done (the Synthesis)'], ['core3', 'Core level 3'], ['tier2', 'Tier 2 open'],
];
p(`### Milestones (game minutes${before ? `, ${beforeName} → ${setName}` : `, ${setName}`})`);
p();
p(`| Milestone | ${lands.map((l) => `Land ${l}`).join(' | ')} |`);
p(`|---|${lands.map(() => '---:').join('|')}|`);
for (const [k, label] of [...QUESTS.map(([id, l]) => [`quest:${id}`, l]), ...OTHER]) {
  p(`| ${label} | ${runs.map((r, i) => pair(before?.[i]?.milestones[k], r.milestones[k])).join(' | ')} |`);
}
p();

// ── the purse ──
const BARS = '▁▂▃▄▅▆▇█';
const spark = (xs, max) => xs.map((v) => BARS[Math.max(0, Math.min(7, Math.floor((v * 8) / (max + 1))))]).join('');
const every = (xs, k) => xs.filter((_, i) => i % k === k - 1);
const maxPurse = Math.max(...runs.flatMap((r) => r.purse), ...(before ?? []).flatMap((r) => r.purse));
p(`### The purse (◉), every 5 minutes over ${runs[0].minutes} minutes (one bar = 5 min, full height = ${maxPurse} ◉)`);
p();
p('```');
for (const [i, r] of runs.entries()) {
  if (before) p(`land ${r.land} before ${spark(every(before[i].purse, 5), maxPurse)}`);
  p(`land ${r.land} ${before ? 'after ' : ''} ${spark(every(r.purse, 5), maxPurse)}`);
}
p('```');
p();
p('| Land | Hour | Purse at its end | Change | Sales | Rewards | Land | Purchases (spot) | Orders |');
p('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of runs) for (const h of r.hours) {
  const k = h.byKind;
  p(`| ${r.land} | ${h.h} | ${h.purse} | ${h.perHour > 0 ? '+' : ''}${h.perHour} | ${k.sales ?? 0} | ${k.reward ?? 0} | ${k.land ?? 0} | ${k.spotBuy ?? 0} | ${k.orders ?? 0} |`);
}
p();

// ── power ──
p(`### Every night (dusk to full sun): the Core's grid at its lowest (‰), minutes under 100 %${before ? ', before → after' : ''}`);
p();
const nights = Math.max(...runs.map((r) => r.nights.length));
p(`| Night (from) | ${lands.map((l) => `Land ${l}`).join(' | ')} |`);
p(`|---|${lands.map(() => '---').join('|')}|`);
for (let n = 0; n < nights; n++) {
  const cell = (r, b) => {
    const x = r.nights[n], y = b?.nights[n];
    if (!x) return '—';
    const s = (q) => (q ? `${q.minSat} ‰ · ${fmt(q.below)} min · ${q.demand} kW · ${q.turbines} t.` : '—');
    return before ? `${s(y)} → **${s(x)}**` : s(x);
  };
  p(`| ${n + 1} (${fmt(runs[0].nights[n]?.from)} min) | ${runs.map((r, i) => cell(r, before?.[i])).join(' | ')} |`);
}
p();
p('Each cell: lowest satisfaction · minutes under 1000 ‰ · the grid\'s demand at dusk · turbines standing at dusk.');
p();

// ── the waits ──
p('### Where the player waited (minutes, by cause and hour)');
p();
const kinds = ['items', 'money', 'quest', 'lab', 'research', 'idle'];
p(`| Land | Hour | ${kinds.join(' | ')} |`);
p(`|---|---:|${kinds.map(() => '---:').join('|')}|`);
for (const r of runs) {
  for (let h = 1; h <= Math.ceil(r.minutes / 60); h++) {
    const sum = Object.fromEntries(kinds.map((k) => [k, 0]));
    for (const w of r.waits) {
      const a = Math.max(w.at, (h - 1) * 60), b = Math.min(w.at + w.min, h * 60);
      if (b > a) sum[w.kind] += b - a;
    }
    p(`| ${r.land} | ${h} | ${kinds.map((k) => fmt(Math.round(sum[k] * 10) / 10)).join(' | ')} |`);
  }
}
p();
p('`items`: building or a plan waiting for the Core\'s stock; `money`: a parcel; `quest`: everything built, the quest\'s outcome not there yet; `lab`: the lab busy; `research`: past the tutorial, the lab working, nothing else to do; `idle`: past the tutorial, the lab waiting for a node\'s resources.');
p();
p('Waits of 3 minutes or more:');
p();
p('| Land | At | Minutes | Cause | Doing | What |');
p('|---|---:|---:|---|---|---|');
for (const r of runs) for (const w of r.waits) if (w.min >= 3 && w.kind !== 'research') p(`| ${r.land} | ${fmt(w.at)} | ${fmt(w.min)} | ${w.kind} | ${w.doing} | ${w.what} |`);
p();

// ── stock and rates ──
const ITEMS = ['iron_ore', 'coal', 'sand', 'copper_ore', 'quartz', 'iron_plate', 'glass', 'copper_wire', 'copper_coil', 'oscillator', 'gear', 'motor', 'copper_plate', 'brick', 'steel'];
const range = (xs) => { const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`; };
for (const h of [1, 2, 3]) {
  if (!runs.every((r) => r.hours[h - 1])) continue;
  p(`### Hour ${h}: the Core's stock and the rates (items a minute over the hour's last 20 minutes; lands ${lands.join(', ')})`);
  p();
  p('| Item | In the Core | Made /min | Into the Core /min | Sold /min |');
  p('|---|---:|---:|---:|---:|');
  for (const it of ITEMS) {
    const m = (f) => range(runs.map((r) => f(r.hours[h - 1])[it] ?? 0));
    p(`| ${it} | ${m((x) => x.stock)} | ${m((x) => x.made)} | ${m((x) => x.intoCore)} | ${m((x) => x.sold)} |`);
  }
  p();
}

// ── research and purchases ──
p('### The lab\'s idle minutes, by why the next node could not start');
p();
for (const r of runs) p(`- Land ${r.land}: ${Object.entries(r.labIdle).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
p();
p('### Bought at CrierBelt (spot), whole items, and what it cost');
p();
for (const r of runs) p(`- Land ${r.land}: ${Object.entries(r.bought).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing'} — ${r.boughtCost} ◉`);
p();
p('### What the map did not leave room for (the bot\'s builders), and problems');
p();
for (const r of runs) p(`- Land ${r.land}: skipped ${r.skipped.join(', ') || 'nothing'}; problems ${r.problems.length ? r.problems.join(' / ') : 'none'}; turbines added after a dipping night at ${r.powerAdds.join(', ') || 'never'}; expertises ${r.expertises.join(', ') || 'none'}`);
console.log(out.join('\n'));
