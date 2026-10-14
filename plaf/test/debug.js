/* Dev tool: watch a level run in the terminal.
 *
 *   node test/debug.js <level#> [--solve] [--every N] [--ticks N]
 *
 * Renders the grid as ASCII (water depth as ░▒▓█, steam as °*), applies the
 * level's solution moves when --solve is given, and reports the outcome.
 */
const Sim = require('../js/simulation.js');
const { LEVELS } = require('../js/levels.js');

const args = process.argv.slice(2);
const li = parseInt(args[0], 10) || 0;
const solve = args.includes('--solve');
const every = args.includes('--every') ? parseInt(args[args.indexOf('--every') + 1], 10) : 0;
const maxTicks = args.includes('--ticks') ? parseInt(args[args.indexOf('--ticks') + 1], 10) : 3000;

const def = LEVELS[li];
const s = Sim.parseLevel(def);

function draw(s) {
  const lines = [];
  for (let y = 0; y < s.rows; y++) {
    let line = '';
    for (let x = 0; x < s.cols; x++) {
      const i = y * s.cols + x;
      const wh = s.wheels.find(w => w.x === x && w.y === y);
      const bo = s.boilers.find(b => b.x === x && b.y === y);
      const co = s.condensers.find(c => c.x === x && c.y === y);
      if (wh) line += 'W';
      else if (bo) line += 'B';
      else if (co) line += 'C';
      else if (s.wall[i]) line += '#';
      else if (s.barGrid[i] !== -1) line += s.bars[s.barGrid[i]].id;
      else if (s.water[i] > 0.7) line += '█';
      else if (s.water[i] > 0.35) line += '▓';
      else if (s.water[i] > 0.08) line += '░';
      else if (s.steam[i] > 0.3) line += '*';
      else if (s.steam[i] > 0.05) line += '°';
      else line += '·';
    }
    lines.push(line);
  }
  console.log(lines.join('\n'));
  const wheels = s.wheels.map(w => w.collected.toFixed(2)).join(' / ');
  console.log(`t=${s.tick} wheels=[${wheels}] goal=${s.goal} fluid=${Sim.totalFluid(s).toFixed(2)} lost=${s.lost.toFixed(2)} win=${Sim.isWin(s)} stuck=${Sim.isStuck(s)}\n`);
}

const SETTLE = 40;
function run(n) {
  for (let i = 0; i < n; i++) {
    Sim.step(s);
    if (every && s.tick % every === 0) draw(s);
    if (Sim.isWin(s)) return true;
  }
  return false;
}

console.log(`Level ${li + 1}: ${def.name}\n`);
draw(s);
run(SETTLE);
draw(s);

if (solve) {
  for (const mv of def.solution) {
    const steps = Math.abs(mv.dx || 0) + Math.abs(mv.dy || 0);
    const ux = Math.sign(mv.dx || 0), uy = Math.sign(mv.dy || 0);
    for (let k = 0; k < steps; k++) {
      const ok = Sim.tryMoveBar(s, mv.bar, ux, uy);
      if (!ok) console.log(`!! move blocked: bar ${mv.bar} (${ux},${uy}) at step ${k + 1}/${steps}`);
      run(mv.settle ?? 6);
    }
    run(SETTLE);
    console.log(`after move ${mv.bar} (${mv.dx || 0},${mv.dy || 0}):`);
    draw(s);
  }
}

run(maxTicks);
draw(s);
console.log(Sim.isWin(s) ? 'WIN' : Sim.isStuck(s) ? 'STUCK (not enough water left)' : 'no win');
