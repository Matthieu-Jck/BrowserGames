/* Waterwheel — headless checks. Run with: node test/solve.test.js
 *
 * For every level: the map parses, the start position alone never wins,
 * the scripted solution wins, the solution minus its last move does NOT
 * win (every move matters), and fluid mass is conserved.
 * Plus unit checks on bar movement, displacement, steam and stuck states.
 */
const Sim = require('../js/simulation.js');
const { LEVELS } = require('../js/levels.js');

let failures = 0;
function check(name, cond) {
  console.log(`  ${cond ? 'ok ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const SETTLE = 40;
const RUN = 6000;

function applyMoves(s, moves) {
  for (let i = 0; i < SETTLE; i++) Sim.step(s);
  for (const mv of moves) {
    const steps = Math.abs(mv.dx || 0) + Math.abs(mv.dy || 0);
    const ux = Math.sign(mv.dx || 0), uy = Math.sign(mv.dy || 0);
    for (let k = 0; k < steps; k++) {
      if (!Sim.tryMoveBar(s, mv.bar, ux, uy)) return false;
      for (let t = 0; t < 6; t++) Sim.step(s);
    }
    for (let t = 0; t < SETTLE; t++) Sim.step(s);
  }
  return true;
}

function runUntilWin(s, max) {
  for (let t = 0; t < max && !Sim.isWin(s); t++) Sim.step(s);
  return Sim.isWin(s);
}

LEVELS.forEach((def, li) => {
  console.log(`Level ${li + 1}: ${def.name}`);

  // start position alone never wins
  const s0 = Sim.parseLevel(def);
  check('start position does not win', !runUntilWin(s0, RUN));

  // scripted solution wins
  const s1 = Sim.parseLevel(def);
  const moved = applyMoves(s1, def.solution);
  check('all solution moves are legal', moved);
  check('solution wins', runUntilWin(s1, RUN));

  // mass conservation: fluid + collected + lost == starting fluid
  const collected = s1.wheels.reduce((t, w) => t + w.collected, 0);
  const balance = Sim.totalFluid(s1) + collected + s1.lost;
  check('mass is conserved', Math.abs(balance - s1.totalStart) < 1e-6);

  // every move matters: dropping the last move must not win
  if (def.solution.length > 0) {
    const s2 = Sim.parseLevel(def);
    applyMoves(s2, def.solution.slice(0, -1));
    check('solution minus last move does not win', !runUntilWin(s2, RUN));
  }
});

console.log('Invariants');

// bar movement legality
{
  const s = Sim.parseLevel({
    name: 'unit-move', goal: 1,
    map: [
      '#....',
      '#ab..',
      '#....',
      '#####',
    ],
  });
  check('bar cannot move into a wall', !Sim.tryMoveBar(s, 'a', -1, 0));
  check('bar cannot move into another bar', !Sim.tryMoveBar(s, 'a', 1, 0));
  check('bar moves into open space', Sim.tryMoveBar(s, 'a', 0, 1));
  const top = Sim.parseLevel({
    name: 'unit-edge', goal: 1,
    map: ['a....', '#####'],
  });
  check('bar cannot move off the top edge', !Sim.tryMoveBar(top, 'a', 0, -1));
}

// displacement conserves mass and pushes water aside
{
  const s = Sim.parseLevel({
    name: 'unit-displace', goal: 1,
    map: [
      '#a#',
      '#.#',
      '#w#',
      '###',
    ],
  });
  const before = Sim.totalFluid(s);
  Sim.tryMoveBar(s, 'a', 0, 1);
  Sim.tryMoveBar(s, 'a', 0, 1); // enters the water cell
  check('displaced water is conserved', Math.abs(Sim.totalFluid(s) - before) < 1e-9);
  check('displaced water moved to the vacated cell', s.water[1 * 3 + 1] > 0.99);
}

// steam rises and does not turn a wheel
{
  const s = Sim.parseLevel({
    name: 'unit-steam', goal: 0.5,
    map: [
      '#.#',
      '#W#',
      '#.#',
      '###',
    ],
  });
  s.steam[2 * 3 + 1] = 1; // below the wheel
  s.totalStart = Sim.totalFluid(s);
  for (let t = 0; t < 200; t++) Sim.step(s);
  check('steam does not turn the wheel', s.wheels[0].collected === 0);
  check('steam rose past the wheel and out', s.lost > 0.9);
}

// water lost off the grid makes a level stuck
{
  const s = Sim.parseLevel({
    name: 'unit-stuck', goal: 2,
    map: [
      '#w.',
      '#W.',
      '##.',
    ],
  });
  for (let t = 0; t < 400; t++) Sim.step(s);
  check('losing too much water is detected as stuck', Sim.isStuck(s));
  check('a stuck level is not a win', !Sim.isWin(s));
}

// boiler + condenser round trip conserves mass
{
  const s = Sim.parseLevel({
    name: 'unit-boil', goal: 1,
    map: [
      '#C#',
      '#.#',
      '#w#',
      '#B#',
    ],
  });
  for (let t = 0; t < 600; t++) Sim.step(s);
  const balance = Sim.totalFluid(s) + s.lost;
  check('boil/condense cycle conserves mass', Math.abs(balance - s.totalStart) < 1e-6);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
