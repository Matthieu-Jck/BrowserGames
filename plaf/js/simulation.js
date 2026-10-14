/* Waterwheel — pure fluid simulation.
 *
 * Water is a per-cell mass field (a classic compressible cellular liquid):
 * it falls, spreads sideways, and slight over-compression lets deep water
 * push upward — so communicating vessels, displacement and overflow all
 * emerge naturally. Steam is the mirror image (it rises). A boiler turns
 * water above it into steam; a condenser turns steam below it back into
 * water. Wheels consume water that reaches their cell; a level is won when
 * every wheel has collected `goal` units.
 *
 * The grid also holds "bars": straight lines of wooden blocks the player
 * slides one cell at a time, vertically or horizontally. A bar moving into
 * fluid displaces that fluid into the cells the bar just left.
 *
 * Everything here is deterministic and side-effect free apart from the
 * passed-in state, so the same module drives the game and the Node tests.
 */

(function () {
  const MAX_MASS = 1.0;       // a "full" cell
  const MAX_COMPRESS = 0.02;  // extra mass a cell holds per cell of depth
  const MIN_MASS = 0.0005;    // below this a cell is treated as dry
  const MAX_FLOW = 1.0;       // max vertical flow per tick
  const MIN_SIDE_FLOW = 0.002;// sideways trickles below this are ignored
  const BOIL_RATE = 0.07;     // water -> steam per tick, per boiler
  const CONDENSE_RATE = 0.12; // steam -> water per tick, per condenser
  const WHEEL_RATE = 0.5;     // water a wheel can swallow per tick

  // How much of `total` mass, split across two vertically stacked cells,
  // belongs in the bottom one once stable.
  function stableBottom(total) {
    if (total <= MAX_MASS) return total;
    if (total < 2 * MAX_MASS + MAX_COMPRESS) {
      return (MAX_MASS * MAX_MASS + total * MAX_COMPRESS) / (MAX_MASS + MAX_COMPRESS);
    }
    return (total + MAX_COMPRESS) / 2;
  }

  // ---- level parsing --------------------------------------------------------
  //
  // Levels are ASCII maps:  '#' wall   '.' empty   'w' water (1 unit)
  //   'W' wheel   'B' boiler   'C' condenser
  //   any other lowercase letter = a bar; contiguous same-letter cells form
  //   one straight horizontal or vertical line.

  function parseLevel(def) {
    const rows = def.map.length;
    const cols = def.map[0].length;
    const wall = new Uint8Array(cols * rows);
    const water = new Float64Array(cols * rows);
    const steam = new Float64Array(cols * rows);
    const wheels = [];
    const boilers = [];
    const condensers = [];
    const barCells = new Map(); // letter -> [{x,y}]

    for (let y = 0; y < rows; y++) {
      if (def.map[y].length !== cols) throw new Error(`${def.name}: ragged map row ${y}`);
      for (let x = 0; x < cols; x++) {
        const ch = def.map[y][x];
        const i = y * cols + x;
        if (ch === '.') continue;
        else if (ch === '#') wall[i] = 1;
        else if (ch === 'w') water[i] = MAX_MASS;
        else if (ch === 'W') wheels.push({ x, y, collected: 0, flow: 0 });
        else if (ch === 'B') { wall[i] = 1; boilers.push({ x, y }); }
        else if (ch === 'C') { wall[i] = 1; condensers.push({ x, y }); }
        else if (/[a-z]/.test(ch)) {
          if (!barCells.has(ch)) barCells.set(ch, []);
          barCells.get(ch).push({ x, y });
        } else throw new Error(`${def.name}: unknown map char '${ch}'`);
      }
    }

    const bars = [];
    for (const [id, cells] of barCells) {
      const xs = new Set(cells.map(c => c.x));
      const ys = new Set(cells.map(c => c.y));
      if (xs.size !== 1 && ys.size !== 1) {
        throw new Error(`${def.name}: bar '${id}' is not a straight line`);
      }
      cells.sort((a, b) => (a.x - b.x) || (a.y - b.y));
      bars.push({ id, cells, horizontal: ys.size === 1 });
    }
    bars.sort((a, b) => (a.id < b.id ? -1 : 1));

    const state = {
      name: def.name,
      cols, rows, wall, water, steam, bars, wheels, boilers, condensers,
      goal: def.goal,
      barGrid: new Int8Array(cols * rows).fill(-1), // bar index per cell
      lost: 0,
      tick: 0,
      totalStart: 0,
    };
    rebuildBarGrid(state);
    state.totalStart = totalFluid(state);
    return state;
  }

  function rebuildBarGrid(state) {
    state.barGrid.fill(-1);
    state.bars.forEach((bar, bi) => {
      for (const c of bar.cells) state.barGrid[c.y * state.cols + c.x] = bi;
    });
  }

  // ---- queries --------------------------------------------------------------

  const inGrid = (s, x, y) => x >= 0 && x < s.cols && y >= 0 && y < s.rows;

  // solid for fluids: walls (incl. boiler/condenser bodies) and bars
  function solid(s, x, y) {
    const i = y * s.cols + x;
    return s.wall[i] === 1 || s.barGrid[i] !== -1;
  }

  function totalFluid(s) {
    let t = 0;
    for (let i = 0; i < s.water.length; i++) t += s.water[i] + s.steam[i];
    return t;
  }

  function isWin(s) {
    return s.wheels.every(w => w.collected >= s.goal - 1e-6);
  }

  // Unwinnable: even if every remaining drop reached the wheels, the
  // combined deficit can't be covered.
  function isStuck(s) {
    if (isWin(s)) return false;
    const deficit = s.wheels.reduce((d, w) => d + Math.max(0, s.goal - w.collected), 0);
    return totalFluid(s) + 1e-6 < deficit;
  }

  // ---- bar movement ---------------------------------------------------------
  //
  // One cell per call. Returns true if the bar moved. Fluid in the cells the
  // bar enters is displaced into the cells it vacates.

  function tryMoveBar(s, barId, dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    const bi = s.bars.findIndex(b => b.id === barId);
    if (bi === -1) return false;
    const bar = s.bars[bi];

    const old = new Set(bar.cells.map(c => c.x + ',' + c.y));
    for (const c of bar.cells) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!inGrid(s, nx, ny)) return false;
      if (old.has(nx + ',' + ny)) continue; // sliding along itself
      const i = ny * s.cols + nx;
      if (s.wall[i] === 1) return false;
      if (s.barGrid[i] !== -1 && s.barGrid[i] !== bi) return false;
      if (s.wheels.some(w => w.x === nx && w.y === ny)) return false;
    }

    const neu = new Set(bar.cells.map(c => (c.x + dx) + ',' + (c.y + dy)));
    const entered = bar.cells
      .map(c => ({ x: c.x + dx, y: c.y + dy }))
      .filter(c => !old.has(c.x + ',' + c.y));
    const vacated = bar.cells.filter(c => !neu.has(c.x + ',' + c.y));

    let dispW = 0, dispS = 0;
    for (const c of entered) {
      const i = c.y * s.cols + c.x;
      dispW += s.water[i]; s.water[i] = 0;
      dispS += s.steam[i]; s.steam[i] = 0;
    }
    for (const c of vacated) {
      const i = c.y * s.cols + c.x;
      s.water[i] += dispW / vacated.length;
      s.steam[i] += dispS / vacated.length;
    }

    for (const c of bar.cells) { c.x += dx; c.y += dy; }
    bar.cells.sort((a, b) => (a.x - b.x) || (a.y - b.y));
    rebuildBarGrid(s);
    return true;
  }

  // ---- simulation tick ------------------------------------------------------

  // dir: +1 = gravity (water), -1 = buoyancy (steam). The fluid "falls"
  // toward dir and over-compression pushes the excess the other way.
  function flowFluid(s, field, dir, diffKey) {
    const { cols, rows } = s;
    const d = s[diffKey] || (s[diffKey] = new Float64Array(cols * rows));
    d.fill(0);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (solid(s, x, y)) continue;
        let remaining = field[i];
        if (remaining < MIN_MASS) continue;

        // fall (water: down; steam: up)
        const fy = y + dir;
        if (fy < 0 || fy >= rows) {
          const f = Math.min(MAX_FLOW, remaining);
          d[i] -= f; s.lost += f; remaining -= f;
        } else if (!solid(s, x, fy)) {
          const fi = i + dir * cols;
          let f = stableBottom(remaining + field[fi]) - field[fi];
          f = Math.max(0, Math.min(f, MAX_FLOW, remaining));
          d[i] -= f; d[fi] += f; remaining -= f;
        }
        if (remaining < MIN_MASS) continue;

        // spread sideways (snapshot-based, so left/right stay symmetric)
        for (const sx of [-1, 1]) {
          const nx = x + sx;
          if (nx < 0 || nx >= cols) {
            const f = remaining / 4;
            if (f > MIN_SIDE_FLOW) { d[i] -= f; s.lost += f; }
          } else if (!solid(s, nx, y)) {
            const ni = i + sx;
            const f = (remaining - field[ni]) / 4;
            if (f > MIN_SIDE_FLOW) { d[i] -= f; d[ni] += f; }
          }
        }

        // compression pushes excess against the flow direction
        // (this is what makes water rise in communicating vessels)
        const uy = y - dir;
        if (remaining > MAX_MASS && uy >= 0 && uy < rows && !solid(s, x, uy)) {
          const ui = i - dir * cols;
          let f = remaining - stableBottom(remaining + field[ui]);
          f = Math.max(0, Math.min(f, MAX_FLOW, remaining));
          d[i] -= f; d[ui] += f;
        }
      }
    }
    for (let i = 0; i < field.length; i++) {
      field[i] += d[i];
      if (field[i] < 0) field[i] = 0;
    }
  }

  function step(s) {
    flowFluid(s, s.water, +1, '_wdiff');

    // wheels drink the water that reaches them
    for (const wh of s.wheels) {
      const i = wh.y * s.cols + wh.x;
      const amt = Math.min(s.water[i], WHEEL_RATE);
      s.water[i] -= amt;
      wh.collected += amt;
      wh.flow = amt;
    }

    // boilers: water directly above turns to steam
    for (const b of s.boilers) {
      const x = b.x, y = b.y - 1;
      if (y < 0 || solid(s, x, y)) continue;
      const i = y * s.cols + x;
      const amt = Math.min(s.water[i], BOIL_RATE);
      s.water[i] -= amt;
      s.steam[i] += amt;
    }

    // condensers: steam directly below turns back to water
    for (const c of s.condensers) {
      const x = c.x, y = c.y + 1;
      if (y >= s.rows || solid(s, x, y)) continue;
      const i = y * s.cols + x;
      const amt = Math.min(s.steam[i], CONDENSE_RATE);
      s.steam[i] -= amt;
      s.water[i] += amt;
    }

    flowFluid(s, s.steam, -1, '_sdiff');
    s.tick++;
  }

  const api = {
    parseLevel, step, tryMoveBar, isWin, isStuck, totalFluid,
    MAX_MASS, MIN_MASS, WHEEL_RATE,
  };

  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.Sim = api;
})();
