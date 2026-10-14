# 💧 Waterwheel

A browser physics-puzzle game: each level holds a pool of real, simulated
water. Slide the **wooden lines of blocks** — up, down, left or right — to
carve a path, and get enough water onto the **wooden wheel** to make it turn.

There is no inventory and nothing to place: every level already contains all
of its pieces, just in the wrong positions.

## Play

Open `index.html` in any modern browser, or serve the folder statically:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

No build step, no dependencies.

## How it works

- **Water is simulated for real** — a mass-per-cell fluid that falls, spreads,
  pools, equalises between communicating vessels, and overflows. Push a line
  *into* a pool and the level rises (the water has to go somewhere).
- **Lines of blocks** slide one cell at a time in any direction. They can't
  pass through rock, each other, or the wheel — but they *can* push through
  water, displacing it.
- **Water is finite.** Anything that runs off the edge of the world is gone;
  lose too much and the level warns you it's unwinnable — hit Reset.
- **Boilers** turn the water above them into **steam, which rises** and hugs
  ceilings. A **condenser** turns steam back into rain. That's how you lift
  water to a wheel that sits higher than the pool.
- Each wheel fills its golden ring as it swallows water; fill every ring to
  win the level.

8 levels, from a one-move tutorial to a Great Machine that chains every
mechanic. Progress is saved in `localStorage`.

## Development

The fluid simulation (`js/simulation.js`) is pure, deterministic and runs in
Node too. Levels are ASCII maps in `js/levels.js`, and every level ships with
a known solution (a sequence of line moves) that the test suite replays:

```sh
npm test   # or: node test/solve.test.js
```

It asserts each level is well-formed, never solved by its start position,
solved by its stored solution, and that no solution move is redundant — plus
rule invariants (mass conservation, displacement, steam never turns a wheel,
lost water is detected as a stuck state).

`node test/debug.js <level#> --solve` watches a level run as ASCII in the
terminal. `node scripts/smoke.mjs` plays all 8 levels end-to-end in headless
Chrome with real pointer drags (serve the game first).
