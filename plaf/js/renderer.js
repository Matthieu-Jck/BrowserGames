/* Waterwheel — canvas rendering.
 *
 * Reads the simulation state every frame: walls, wooden bars, the water and
 * steam mass fields, boilers, condensers and wheels. Water renders as pooled
 * slabs where supported and as narrow falling streams in mid-air; steam as
 * drifting puffs. Wheels are wooden, spin with the flow they swallow, and
 * carry a golden progress ring.
 */
const Renderer = (() => {
  const CELL = 56;
  let canvas = null;
  let ctx = null;
  let state = null;
  let dpr = 1;

  function init(c) {
    canvas = c;
    ctx = c.getContext('2d');
  }

  function setLevel(s) {
    state = s;
    dpr = window.devicePixelRatio || 1;
    canvas.width = s.cols * CELL * dpr;
    canvas.height = s.rows * CELL * dpr;
    canvas.style.width = (s.cols * CELL) + 'px';
    canvas.style.height = (s.rows * CELL) + 'px';
  }

  function cellAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const lx = (clientX - r.left) * (state.cols * CELL) / r.width;
    const ly = (clientY - r.top) * (state.rows * CELL) / r.height;
    return { px: lx, py: ly, x: Math.floor(lx / CELL), y: Math.floor(ly / CELL) };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- terrain ----------------------------------------------------------------

  function drawBackground() {
    const w = state.cols * CELL, h = state.rows * CELL;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#13202e');
    g.addColorStop(1, '#0c141e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < state.cols; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, h); }
    for (let y = 1; y < state.rows; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(state.cols * CELL, y * CELL); }
    ctx.stroke();
  }

  function wallAt(x, y) {
    if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return true;
    return state.wall[y * state.cols + x] === 1;
  }

  function drawWalls() {
    const dev = new Set();
    for (const b of state.boilers) dev.add(b.x + ',' + b.y);
    for (const c of state.condensers) dev.add(c.x + ',' + c.y);

    ctx.fillStyle = '#2c3a49';
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (!wallAt(x, y) || dev.has(x + ',' + y)) continue;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // exposed top edges catch the light
    ctx.fillStyle = 'rgba(160,190,220,0.18)';
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (!wallAt(x, y) || dev.has(x + ',' + y)) continue;
        if (y === 0 || !wallAt(x, y - 1)) ctx.fillRect(x * CELL, y * CELL, CELL, 3);
      }
    }
    // faint speckle for texture
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (!wallAt(x, y) || dev.has(x + ',' + y)) continue;
        const px = x * CELL, py = y * CELL;
        ctx.fillRect(px + ((x * 7 + y * 13) % 5) * 9 + 6, py + ((x * 11 + y * 5) % 4) * 11 + 8, 5, 3);
      }
    }
  }

  // ---- devices ------------------------------------------------------------------

  function drawBoiler(b, time) {
    const px = b.x * CELL, py = b.y * CELL;
    ctx.fillStyle = '#3a3026';
    ctx.fillRect(px, py, CELL, CELL);
    roundRect(px + 4, py + 4, CELL - 8, CELL - 8, 6);
    ctx.fillStyle = '#241a12';
    ctx.fill();
    // flames flicker in the firebox
    const fl = Math.sin(time / 90 + b.x) * 3;
    for (let i = 0; i < 3; i++) {
      const fx = px + 14 + i * 14;
      const fh = 14 + ((i * 17 + Math.floor(time / 110)) % 3) * 5 + fl;
      const g = ctx.createLinearGradient(0, py + CELL - 8 - fh, 0, py + CELL - 8);
      g.addColorStop(0, '#ffd34d');
      g.addColorStop(0.5, '#ff8a2a');
      g.addColorStop(1, '#c23c12');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx, py + CELL - 8);
      ctx.quadraticCurveTo(fx - 6, py + CELL - 10 - fh * 0.4, fx, py + CELL - 8 - fh);
      ctx.quadraticCurveTo(fx + 6, py + CELL - 10 - fh * 0.4, fx, py + CELL - 8);
      ctx.fill();
    }
    // heat shimmer on top edge
    ctx.fillStyle = 'rgba(255,120,40,0.5)';
    ctx.fillRect(px + 3, py, CELL - 6, 3);
  }

  function drawCondenser(c) {
    const px = c.x * CELL, py = c.y * CELL;
    roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 7);
    ctx.fillStyle = '#7d97a8';
    ctx.fill();
    ctx.strokeStyle = '#aac4d4';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      const fy = py + 8 + i * 10;
      ctx.beginPath();
      ctx.moveTo(px + 8, fy);
      ctx.lineTo(px + CELL - 8, fy);
      ctx.stroke();
    }
    // cold drip nub
    ctx.fillStyle = '#bcd8ea';
    ctx.beginPath();
    ctx.arc(px + CELL / 2, py + CELL - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWheel(w, time) {
    const cx = (w.x + 0.5) * CELL, cy = (w.y + 0.5) * CELL;
    const R = CELL * 0.42;

    // spin with the water it swallows, with a little inertia
    w._vel = Math.max((w._vel || 0) * 0.96, Math.min(0.5, w.flow * 1.6));
    w._ang = (w._ang || 0) + w._vel;

    // golden progress ring
    const p = Math.min(1, w.collected / state.goal);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.stroke();
    if (p > 0) {
      ctx.strokeStyle = p >= 1 ? '#ffd34d' : '#e9b949';
      ctx.shadowColor = p >= 1 ? 'rgba(255,211,77,0.8)' : 'transparent';
      ctx.shadowBlur = p >= 1 ? 10 : 0;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 6, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(w._ang);
    // paddles
    ctx.fillStyle = '#7a5230';
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 3);
      ctx.fillRect(-3, -R, 6, R);
      ctx.fillRect(-9, -R, 18, 7);
      ctx.restore();
    }
    // rim
    ctx.strokeStyle = '#9c6b3f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    // hub
    ctx.fillStyle = '#5d3d20';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- fluids -------------------------------------------------------------------

  function solidAt(x, y) {
    if (x < 0 || x >= state.cols) return true;
    if (y < 0 || y >= state.rows) return false;
    const i = y * state.cols + x;
    return state.wall[i] === 1 || state.barGrid[i] !== -1;
  }

  function waterAt(x, y) {
    if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return 0;
    return state.water[y * state.cols + x];
  }

  function drawWater(time) {
    ctx.fillStyle = 'rgba(52,140,235,0.88)';
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const m = waterAt(x, y);
        if (m < 0.01) continue;
        const px = x * CELL, py = y * CELL;
        const supported = solidAt(x, y + 1) || waterAt(x, y + 1) > 0.95;
        if (supported) {
          // pooled: a slab from the cell floor; full if buried
          const fill = (waterAt(x, y - 1) > 0.05) ? 1 : Math.min(1, m);
          const h = fill * CELL;
          ctx.fillRect(px, py + CELL - h, CELL, h);
          if (fill < 1) {
            // animated surface glint
            const ripple = Math.sin(time / 300 + x * 1.7) * 1.2;
            ctx.fillStyle = 'rgba(170,215,255,0.5)';
            ctx.fillRect(px, py + CELL - h + ripple, CELL, 2);
            ctx.fillStyle = 'rgba(52,140,235,0.88)';
          }
        } else {
          // falling: a narrow stream, width by mass
          const wd = Math.max(7, Math.min(0.55, m * 0.55) * CELL);
          const sway = Math.sin(time / 160 + y * 0.9) * 1.5;
          ctx.fillRect(px + (CELL - wd) / 2 + sway, py, wd, CELL + 1);
        }
      }
    }
  }

  function drawSteam(time) {
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const m = state.steam[y * state.cols + x];
        if (m < 0.02) continue;
        const px = (x + 0.5) * CELL, py = (y + 0.5) * CELL;
        const r = Math.sqrt(Math.min(1, m)) * CELL * 0.34;
        for (let k = 0; k < 2; k++) {
          const ox = Math.sin(time / 400 + x * 2 + k * 2.4) * 6;
          const oy = Math.cos(time / 350 + y * 1.6 + k * 1.9) * 5;
          const g = ctx.createRadialGradient(px + ox, py + oy, 1, px + ox, py + oy, r);
          g.addColorStop(0, `rgba(214,226,236,${0.34 * Math.min(1, m)})`);
          g.addColorStop(1, 'rgba(214,226,236,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px + ox, py + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ---- bars ---------------------------------------------------------------------

  function drawBar(bar, hovered, dragged) {
    const xs = bar.cells.map(c => c.x), ys = bar.cells.map(c => c.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...xs), y1 = Math.max(...ys);
    const px = x0 * CELL + 3, py = y0 * CELL + 3;
    const w = (x1 - x0 + 1) * CELL - 6, h = (y1 - y0 + 1) * CELL - 6;

    if (hovered || dragged) {
      ctx.shadowColor = dragged ? 'rgba(255,200,90,0.9)' : 'rgba(255,200,90,0.55)';
      ctx.shadowBlur = dragged ? 18 : 12;
    }
    roundRect(px, py, w, h, 9);
    const g = ctx.createLinearGradient(px, py, px + (h > w ? w : 0), py + (h > w ? 0 : h));
    g.addColorStop(0, '#a8744a');
    g.addColorStop(0.5, '#8d5e38');
    g.addColorStop(1, '#7a4f2d');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#5d3d20';
    ctx.lineWidth = 2;
    ctx.stroke();

    // plank joints between cells
    ctx.strokeStyle = 'rgba(60,38,18,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < bar.cells.length; i++) {
      if (y0 === y1 && bar.cells.length > 1) {
        const jx = (x0 + i) * CELL;
        ctx.moveTo(jx, py + 5);
        ctx.lineTo(jx, py + h - 5);
      } else {
        const jy = (y0 + i) * CELL;
        ctx.moveTo(px + 5, jy);
        ctx.lineTo(px + w - 5, jy);
      }
    }
    ctx.stroke();

    // wood grain
    ctx.strokeStyle = 'rgba(255,220,170,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (w >= h) {
      ctx.moveTo(px + 6, py + h * 0.35); ctx.lineTo(px + w - 6, py + h * 0.3);
      ctx.moveTo(px + 6, py + h * 0.7); ctx.lineTo(px + w - 6, py + h * 0.74);
    } else {
      ctx.moveTo(px + w * 0.35, py + 6); ctx.lineTo(px + w * 0.3, py + h - 6);
      ctx.moveTo(px + w * 0.7, py + 6); ctx.lineTo(px + w * 0.74, py + h - 6);
    }
    ctx.stroke();
  }

  // ---- frame ----------------------------------------------------------------------

  function render({ state: s, dragBar, hoverBar, time }) {
    state = s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    drawWalls();
    for (const b of s.boilers) drawBoiler(b, time);
    for (const c of s.condensers) drawCondenser(c);
    drawWater(time);
    for (const w of s.wheels) drawWheel(w, time);
    s.bars.forEach((bar, bi) => drawBar(bar, bi === hoverBar, bi === dragBar));
    drawSteam(time);
  }

  return { init, setLevel, cellAt, render, CELL };
})();
