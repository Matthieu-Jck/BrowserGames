/* Waterwheel — game state, input and HUD.
 *
 * The simulation runs live at a fixed 30 Hz; the player drags whole bars
 * (lines of blocks) one cell at a time, horizontally or vertically, and the
 * water reacts immediately.
 */
(() => {
  const canvas = document.getElementById('game');
  const levelBar = document.getElementById('level-bar');
  const levelName = document.getElementById('level-name');
  const levelHint = document.getElementById('level-hint');
  const statusLine = document.getElementById('status');
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const btnNext = document.getElementById('btn-next');
  const btnReplay = document.getElementById('btn-replay');
  const btnReset = document.getElementById('btn-reset');

  const STORAGE_KEY = 'waterwheel.unlocked';
  let unlocked = Math.max(1, parseInt(localStorage.getItem(STORAGE_KEY), 10) || 1);

  const SIM_DT = 1000 / 30;
  let levelIndex = 0;
  let state = null;
  let won = false;
  let winTimer = null;
  let drag = null;   // {bi, ax, ay}  anchor = grab cell relative to cells[0]
  let hoverBar = -1;
  let acc = 0;
  let lastT = 0;

  Renderer.init(canvas);

  // ---- level lifecycle ------------------------------------------------------

  function loadLevel(i) {
    levelIndex = i;
    state = Sim.parseLevel(LEVELS[i]);
    won = false;
    drag = null;
    hoverBar = -1;
    acc = 0;
    clearTimeout(winTimer);
    winTimer = null;
    winOverlay.classList.add('hidden');
    Renderer.setLevel(state);
    levelName.textContent = `Level ${i + 1} — ${state.name}`;
    levelHint.textContent = LEVELS[i].hint;
    updateLevelBar();
  }

  function showWin() {
    won = true;
    const last = levelIndex === LEVELS.length - 1;
    winTitle.textContent = last
      ? '✨ You built the Great Machine! ✨'
      : (state.wheels.length > 1 ? 'The wheels turn!' : 'The wheel turns!');
    btnNext.style.display = last ? 'none' : '';
    winOverlay.classList.remove('hidden');
    unlocked = Math.max(unlocked, Math.min(LEVELS.length, levelIndex + 2));
    localStorage.setItem(STORAGE_KEY, String(unlocked));
    updateLevelBar();
  }

  // ---- HUD ------------------------------------------------------------------

  function updateLevelBar() {
    levelBar.innerHTML = '';
    LEVELS.forEach((lvl, i) => {
      const b = document.createElement('button');
      b.textContent = i + 1;
      b.title = lvl.name;
      if (i === levelIndex) b.classList.add('current');
      if (i + 1 < unlocked) b.classList.add('done');
      b.disabled = i + 1 > unlocked;
      b.addEventListener('click', () => loadLevel(i));
      levelBar.appendChild(b);
    });
  }

  function updateStatus() {
    const parts = state.wheels.map(w =>
      `${Math.min(w.collected, state.goal).toFixed(1)} / ${state.goal}`);
    statusLine.textContent = `💧 ${parts.join('   ·   ')}`;
    const stuck = Sim.isStuck(state);
    statusLine.classList.toggle('stuck', stuck);
    if (stuck) statusLine.textContent = '⚠ Too much water lost — press Reset';
  }

  btnReset.addEventListener('click', () => loadLevel(levelIndex));
  btnReplay.addEventListener('click', () => loadLevel(levelIndex));
  btnNext.addEventListener('click', () => loadLevel(Math.min(LEVELS.length - 1, levelIndex + 1)));

  // ---- input ----------------------------------------------------------------

  function barAt(x, y) {
    if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return -1;
    return state.barGrid[y * state.cols + x];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (won) return;
    const c = Renderer.cellAt(e.clientX, e.clientY);
    const bi = barAt(c.x, c.y);
    if (bi === -1) return;
    const ref = state.bars[bi].cells[0];
    drag = { bi, ax: c.x - ref.x, ay: c.y - ref.y };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    const c = Renderer.cellAt(e.clientX, e.clientY);
    if (!drag) {
      hoverBar = won ? -1 : barAt(c.x, c.y);
      canvas.classList.toggle('grab', hoverBar !== -1);
      return;
    }
    // walk the bar one cell at a time toward the pointer, preferring the
    // axis with the larger remaining distance; stop when fully blocked
    const bar = state.bars[drag.bi];
    for (let guard = 0; guard < 64; guard++) {
      const ref = bar.cells[0];
      const dx = (c.x - drag.ax) - ref.x;
      const dy = (c.y - drag.ay) - ref.y;
      if (dx === 0 && dy === 0) break;
      const tryMoves = Math.abs(dx) >= Math.abs(dy)
        ? [[Math.sign(dx), 0], [0, Math.sign(dy)]]
        : [[0, Math.sign(dy)], [Math.sign(dx), 0]];
      let movedAny = false;
      for (const [mx, my] of tryMoves) {
        if ((mx || my) && Sim.tryMoveBar(state, bar.id, mx, my)) { movedAny = true; break; }
      }
      if (!movedAny) break;
    }
  });

  function endDrag() {
    drag = null;
    canvas.classList.remove('grabbing');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- main loop --------------------------------------------------------------

  function frame(t) {
    if (!lastT) lastT = t;
    acc += Math.min(t - lastT, 200);
    lastT = t;
    let steps = 0;
    while (acc >= SIM_DT && steps < 4) {
      Sim.step(state);
      acc -= SIM_DT;
      steps++;
    }
    if (acc > SIM_DT * 4) acc = 0;

    if (!won && !winTimer && Sim.isWin(state)) {
      winTimer = setTimeout(showWin, 900); // let the wheel visibly spin first
    }
    updateStatus();

    Renderer.render({
      state,
      dragBar: drag ? drag.bi : -1,
      hoverBar: drag ? drag.bi : hoverBar,
      time: t,
    });
    requestAnimationFrame(frame);
  }

  loadLevel(0);
  requestAnimationFrame(frame);
})();
