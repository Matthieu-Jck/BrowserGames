// map.js — the floor plan, hand-authored.
// '#' wall · '.' floor · P player start · E elevator win zone
// 1/2/3 fuses · b battery · p desk phone
// Pure data module (no three.js import) so it can be validated in node.

export const CELL = 4;       // world units per grid cell
export const WALL_H = 3.2;   // ceiling height

export const ROWS = [
  '##########################################', // 0
  '##########################################', // 1
  '#############................#############', // 2  server room
  '#############.2..............#############', // 3
  '#############................#############', // 4
  '#############..............b.#############', // 5
  '#############................#############', // 6
  '####################..####################', // 7  ── the long hallway
  '####################..####################', // 8
  '##...............###..##...............###', // 9  cubicles · break room
  '##...............###..##...........b...###', // 10
  '##......p........###..##...............###', // 11
  '##...............###...................###', // 12 break room door
  '##...............###...................###', // 13
  '##...............###..##...............###', // 14
  '##....................##...............###', // 15 cubicle door
  '##....................####################', // 16
  '##...............###..####################', // 17
  '##...............###..##...............###', // 18 storage
  '##...............###..##...............###', // 19
  '##1..............###..##...............###', // 20
  '##...............###...................###', // 21 storage door
  '####################...................###', // 22
  '####################..##...............###', // 23
  '####################..##.............3.###', // 24
  '####################..##...............###', // 25
  '#############................#############', // 26 lobby
  '#############................#############', // 27
  '#############................#############', // 28
  '#############.......P........#############', // 29
  '#############................#############', // 30
  '#############.b..............#############', // 31
  '#############................#############', // 32
  '####################..####################', // 33 elevator alcove
  '####################EE####################', // 34
  '##########################################', // 35
];

export const W = ROWS[0].length;
export const H = ROWS.length;

// Named regions — used for lighting control, events, and floor materials.
const REGIONS = [
  { id: 'server',   x0: 13, x1: 28, y0: 2,  y1: 6  },
  { id: 'cubicles', x0: 2,  x1: 16, y0: 9,  y1: 21 },
  { id: 'break',    x0: 24, x1: 38, y0: 9,  y1: 16 },
  { id: 'storage',  x0: 24, x1: 38, y0: 18, y1: 25 },
  { id: 'lobby',    x0: 13, x1: 28, y0: 26, y1: 34 },
];

export function parseMap() {
  const grid = [];          // grid[y][x] -> true = solid
  const markers = { fuses: [], batteries: [], elevator: [] };
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const c = ROWS[y][x];
      row.push(c === '#');
      const wx = (x + 0.5) * CELL, wz = (y + 0.5) * CELL;
      if (c === 'P') markers.start = { x: wx, z: wz };
      if (c === 'E') markers.elevator.push({ x: wx, z: wz, cx: x, cy: y });
      if (c === 'p') markers.phone = { x: wx, z: wz, cx: x, cy: y };
      if (c >= '1' && c <= '3') markers.fuses[+c - 1] = { x: wx, z: wz, cx: x, cy: y };
      if (c === 'b') markers.batteries.push({ x: wx, z: wz, cx: x, cy: y });
    }
    grid.push(row);
  }
  return { grid, markers };
}

export function regionAt(cx, cy) {
  for (const r of REGIONS)
    if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) return r.id;
  return 'corridor';
}

export function regionAtWorld(x, z) {
  return regionAt(Math.floor(x / CELL), Math.floor(z / CELL));
}

export function makeSolidTest(grid) {
  return (cx, cy) => cy < 0 || cy >= H || cx < 0 || cx >= W || grid[cy][cx];
}

// Coarse line-of-sight against walls only (sampled march).
export function makeLosTest(grid) {
  const solid = makeSolidTest(grid);
  return (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (solid(Math.floor((x1 + dx * t) / CELL), Math.floor((z1 + dz * t) / CELL))) return false;
    }
    return true;
  };
}

// BFS path between world points; returns array of world waypoints (cell centers).
export function makePathfinder(grid) {
  const solid = makeSolidTest(grid);
  return (x1, z1, x2, z2) => {
    const sx = Math.floor(x1 / CELL), sy = Math.floor(z1 / CELL);
    const tx = Math.floor(x2 / CELL), ty = Math.floor(z2 / CELL);
    if (solid(tx, ty) || solid(sx, sy)) return null;
    const key = (x, y) => y * W + x;
    const prev = new Map([[key(sx, sy), -1]]);
    const q = [[sx, sy]];
    while (q.length) {
      const [cx, cy] = q.shift();
      if (cx === tx && cy === ty) {
        const path = [];
        let k = key(tx, ty);
        while (k !== -1) {
          const py = Math.floor(k / W), px = k % W;
          path.push({ x: (px + 0.5) * CELL, z: (py + 0.5) * CELL });
          k = prev.get(k);
        }
        return path.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
        if (!solid(nx, ny) && !prev.has(k)) { prev.set(k, key(cx, cy)); q.push([nx, ny]); }
      }
    }
    return null;
  };
}
