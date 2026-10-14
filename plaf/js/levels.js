/* Waterwheel — level definitions.
 *
 * Maps are ASCII grids:
 *   '#' rock          '.' empty          'w' water (1 unit)
 *   'W' wheel         'B' boiler         'C' condenser
 *   a-z  movable bars: contiguous same-letter cells form one straight
 *        line of wooden blocks the player can slide.
 *
 * goal:     units of water EACH wheel must collect to win.
 * solution: a known winning sequence of bar moves (dx/dy in whole cells),
 *           used only by test/solve.test.js.
 */

const LEVELS = [
  {
    name: 'Pull the Plug',
    hint: 'Water always finds a way down. Slide the wooden line up to let it out.',
    goal: 3,
    map: [
      '..........',
      '..........',
      '..........',
      '#wwa......',
      '#wwa......',
      '###a#.....',
      '..#.#.....',
      '###W######',
    ],
    solution: [
      { bar: 'a', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'Mind the Gap',
    hint: 'Lines slide sideways too. Water that falls off the world is gone for good.',
    goal: 3,
    map: [
      '............',
      '............',
      '#wwa........',
      '#wwa........',
      '#####..###.#',
      '.......bb#.#',
      '.........#.#',
      '#####..###W#',
    ],
    solution: [
      { bar: 'b', dx: -2, dy: 0 },
      { bar: 'b', dx: 0, dy: -1 },
      { bar: 'a', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'Crossed Lines',
    hint: 'Lines cannot pass through each other. Clear the way first.',
    goal: 3,
    map: [
      '..........',
      '..........',
      '..bbb.....',
      '#wwa......',
      '#wwa......',
      '###a#.....',
      '..#.#.....',
      '###W######',
    ],
    solution: [
      { bar: 'b', dx: 2, dy: 0 },
      { bar: 'a', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'Make Room',
    hint: 'Push the line into the pool — the water has to go somewhere.',
    goal: 1.2,
    map: [
      '#a.........',
      '#a.........',
      '#a.........',
      '#.....#....',
      '#www#.#....',
      '#www#.#....',
      '#####.#....',
      '#####W#####',
    ],
    solution: [
      { bar: 'a', dx: 0, dy: 3 },
    ],
  },
  {
    name: 'Full Steam',
    hint: 'The wheel sits high and dry… so boil the water! Steam rises, and a condenser turns it back into rain.',
    goal: 1.8,
    map: [
      '...........',
      '...........',
      '.....##C...',
      '....#...#..',
      '....#.#.#..',
      '#wwa..#.#..',
      '#wwa..#W#..',
      '#####B#####',
      '###########',
    ],
    solution: [
      { bar: 'a', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'Steam, Bent',
    hint: 'Steam hugs the ceiling and slips through any hole. Seal the leak before you boil.',
    goal: 2,
    map: [
      '............',
      '.......bb...',
      '............',
      '.....##..C..',
      '....#.....#.',
      '#wwa..###.#.',
      '#wwa..###.#.',
      '#####B###W#.',
      '############',
    ],
    solution: [
      { bar: 'b', dx: 0, dy: 2 },
      { bar: 'a', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'Twin Falls',
    hint: 'Two wheels, one pool each. Bridge one side, unblock the other.',
    goal: 2.2,
    map: [
      '..............',
      '.........dd...',
      '#wwa......cww#',
      '#wwa......cww#',
      '####..#.#.####',
      '......bb#.....',
      '........#.....',
      '####..#W#W####',
      '####..########',
    ],
    solution: [
      { bar: 'b', dx: -2, dy: 0 },
      { bar: 'b', dx: 0, dy: -1 },
      { bar: 'a', dx: 0, dy: -2 },
      { bar: 'd', dx: -2, dy: 0 },
      { bar: 'c', dx: 0, dy: -2 },
    ],
  },
  {
    name: 'The Great Machine',
    hint: 'Everything at once: clear the blocker, bridge the pit, raise the level — and let the steam do the climbing.',
    goal: 1.2,
    map: [
      '#g............',
      '#g........##C.',
      '#g.......#...#',
      '#bb........#.#',
      '#www##..##.#.#',
      '#www##..##.#.#',
      '#www##..##.#.#',
      '######..##.#.#',
      '######..##.#W#',
      '######..##B###',
    ],
    solution: [
      { bar: 'b', dx: 5, dy: 0 },
      { bar: 'b', dx: 0, dy: 1 },
      { bar: 'g', dx: 0, dy: 3 },
    ],
  },
];

if (typeof module !== 'undefined') {
  module.exports = { LEVELS };
}
