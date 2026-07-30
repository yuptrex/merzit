/* game.js — main engine: rendering, input, loop, state management */

(function () {
  'use strict';

  const GRID_SIZE = 5;
  const STORAGE_KEY = 'dicemerge_save_v1';
  const BEST_KEY = 'dicemerge_best_v1';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Overlay canvas covers the whole viewport so the dragged die can render
  // above the HUD/tray/background instead of being clipped at the board's
  // own edges.
  const dragCanvas = document.getElementById('drag-canvas');
  const dragCtx = dragCanvas.getContext('2d');

  const boardImages = {};
  function loadBoardImages() {
    const names = ['board_frame', 'cell_empty', 'cell_highlight', 'cell_invalid'];
    for (const n of names) {
      const img = new Image();
      img.src = `assets/board/${n}.png`;
      boardImages[n] = img;
    }
  }

  loadDiceImages();
  loadEffectImages();
  loadBoardImages();

  // ---------------- Game State ----------------
  const state = {
    board: new Board(GRID_SIZE),
    queue: new DiceQueue(3),
    score: 0,
    best: parseInt(localStorage.getItem(BEST_KEY) || '0', 10),
    powerups: { bomb: 2, undo: 3, cannon: 1 },
    activePower: null,
    paused: false,
    gameOver: false,
    started: false,
    highestValueReached: 1,
    history: [], // for undo: snapshots of {board, score, queue}
  };

  const effects = new EffectSystem();

  // ---------------- Layout ----------------
  const layout = {
    dpr: Math.max(1, window.devicePixelRatio || 1),
    boardPx: 0,   // rendered board size (css px)
    boardX: 0, boardY: 0,
    cellSize: 0,
    margin: 0,
  };

  function resize() {
    const wrap = document.getElementById('board-wrap');
    const rect = wrap.getBoundingClientRect();
    let size = Math.floor(Math.min(rect.width, rect.height));
    if (!size || size < 10) size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.85);
    layout.boardPx = size;
    layout.dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.floor(size * layout.dpr);
    canvas.height = Math.floor(size * layout.dpr);
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);

    layout.margin = size * 0.045;
    layout.cellSize = (size - layout.margin * 2) / GRID_SIZE;
    layout.boardX = 0;
    layout.boardY = 0;

    // Overlay canvas spans the full viewport (in CSS px, same as clientX/Y)
    // so the drag ghost can be positioned anywhere on screen — including
    // above the tray/background — without ever being clipped.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    dragCanvas.style.width = vw + 'px';
    dragCanvas.style.height = vh + 'px';
    dragCanvas.width = Math.floor(vw * layout.dpr);
    dragCanvas.height = Math.floor(vh * layout.dpr);
    dragCtx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);

    // Offset of the board canvas within the viewport, so board-local
    // coordinates (used everywhere else) can be translated to viewport
    // coordinates for drawing on the overlay.
    const boardRect = canvas.getBoundingClientRect();
    layout.viewportOffsetX = boardRect.left;
    layout.viewportOffsetY = boardRect.top;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));

  function cellToPixel(row, col) {
    const x = layout.margin + col * layout.cellSize + layout.cellSize / 2;
    const y = layout.margin + row * layout.cellSize + layout.cellSize / 2;
    return { x, y };
  }

  function pixelToCell(x, y) {
    const col = Math.floor((x - layout.margin) / layout.cellSize);
    const row = Math.floor((y - layout.margin) / layout.cellSize);
    return { row, col };
  }

  // ---------------- Animated die sprites on board ----------------
  // We track visual dice separate from logical board so we can animate
  // placement, merges, and removals smoothly.
  let visualDice = []; // {row, col, value, x, y, scale, alpha, id, rotation}
  let visualId = 0;

  function syncVisualsFromBoard() {
    visualDice = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = state.board.get(r, c);
        if (cell) {
          const { x, y } = cellToPixel(r, c);
          visualDice.push({
            row: r, col: c, value: cell.value,
            x, y, targetX: x, targetY: y,
            scale: 1, targetScale: 1, alpha: 1, rotation: 0,
            id: visualId++,
          });
        }
      }
    }
  }

  function findVisual(row, col) {
    return visualDice.find(v => v.row === row && v.col === col);
  }

  // ---------------- Drag state ----------------
  // States: 'idle' -> 'dragging' (die lifted immediately on touch/press, follows
  // pointer) -> back to 'idle' on release.
  const drag = {
    state: 'idle',
    value: null,
    x: 0, y: 0,
    hoverCell: null,
    valid: false,
    liftProgress: 0, // 0..1, animates the die "lifting" off the tray
  };

  function trayDieOrigin() {
    // approximate spawn position: center of the highlighted next-die slot,
    // projected onto the canvas coordinate space (used for the lift animation start)
    const el = document.querySelector('#queue-dice .queue-die');
    const rect = canvas.getBoundingClientRect();
    if (!el) return { x: layout.boardPx / 2, y: layout.boardPx - 20 };
    const elRect = el.getBoundingClientRect();
    return {
      x: elRect.left + elRect.width / 2 - rect.left,
      y: elRect.top + elRect.height / 2 - rect.top,
    };
  }

  function beginDragLift(pos) {
    if (state.paused || state.gameOver || !state.started) return;
    drag.state = 'dragging';
    drag.value = state.queue.peekNext();
    drag.x = pos.x;
    drag.y = pos.y;
    drag.hoverCell = null;
    drag.valid = false;
    drag.liftProgress = 0;
    animateDragLift();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
  }

  function animateDragLift() {
    const obj = { t: 0 };
    const dur = 0.14;
    const tick = () => {
      if (drag.state !== 'dragging') return;
      obj.t += 1 / 60;
      drag.liftProgress = Math.min(1, obj.t / dur);
      if (drag.liftProgress < 1) requestAnimationFrame(tick);
    };
    tick();
  }


  function refreshQueueUI() {
    const el = document.getElementById('queue-dice');
    el.innerHTML = '';
    state.queue.queue.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'queue-die';
      d.style.backgroundImage = `url('assets/dice/die_${Math.min(v, DICE_MAX_VALUE)}.png')`;
      el.appendChild(d);
    });
  }

  function refreshPowerupUI() {
    for (const key of ['bomb', 'undo', 'cannon']) {
      const btn = document.getElementById(`power-${key}`);
      const count = document.getElementById(`count-${key}`);
      count.textContent = state.powerups[key];
      btn.classList.toggle('disabled', state.powerups[key] <= 0);
      btn.classList.toggle('active-power', state.activePower === key);
    }
  }

  function refreshScoreUI(animateDelta) {
    document.getElementById('score-value').textContent = state.score;
    document.getElementById('best-value').textContent = state.best;
  }

  // ---------------- History (undo) ----------------
  function pushHistory() {
    state.history.push({
      board: state.board.clone(),
      score: state.score,
      queue: JSON.parse(JSON.stringify(state.queue.queue)),
      maxUnlocked: state.queue.maxUnlocked,
      highest: state.highestValueReached,
    });
    if (state.history.length > 10) state.history.shift();
  }

  function performUndo() {
    if (state.powerups.undo <= 0) return;
    if (state.history.length === 0) {
      window.Sound && window.Sound.invalid();
      flashMessage('Nothing to undo');
      return;
    }
    window.Sound && window.Sound.undo();
    const snap = state.history.pop();
    state.board = snap.board;
    state.score = snap.score;
    state.queue.queue = snap.queue;
    state.queue.maxUnlocked = snap.maxUnlocked;
    state.highestValueReached = snap.highest;
    state.powerups.undo--;
    syncVisualsFromBoard();
    refreshQueueUI();
    refreshScoreUI();
    refreshPowerupUI();
    saveGame();
  }

  // ---------------- Placement + merge resolution ----------------
  function tryPlaceDie(row, col, value) {
    if (!state.board.inBounds(row, col)) return false;
    if (!state.board.isEmpty(row, col)) return false;
    if (state.paused || state.gameOver) return false;

    pushHistory();
    window.Sound && window.Sound.place();

    state.board.set(row, col, { value });
    const { x, y } = cellToPixel(row, col);
    const v = {
      row, col, value, x, y: y - layout.cellSize * 0.6, targetX: x, targetY: y,
      scale: 0.2, targetScale: 1, alpha: 0, id: visualId++, rotation: (Math.random() - 0.5) * 0.3,
    };
    visualDice.push(v);
    animateAlphaTo(v, 1, 0.15);
    // Same settle-into-cell animation as a merge result, so a freshly placed
    // die lands flush with its cell border instead of stopping at an
    // arbitrary in-between size.
    animateScaleTo(v, 1, 0.22, true);

    state.queue.popNext();
    refreshQueueUI();

    // resolve merges after a short beat so placement animation is visible
    setTimeout(() => {
      const steps = resolveMerges(state.board, row, col);
      if (steps.length > 0) {
        applyMergeSteps(steps);
      } else {
        checkGameOver();
      }
      saveGame();
    }, 140);

    return true;
  }

  function applyMergeSteps(steps) {
    steps.forEach((step, i) => {
      setTimeout(() => {
        // remove visuals for the consumed group
        for (const g of step.group) {
          const vis = findVisual(g.row, g.col);
          if (vis) {
            vis.merging = true;
            animateScaleTo(vis, 0, 0.18);
            animateAlphaTo(vis, 0, 0.18);
            setTimeout(() => {
              visualDice = visualDice.filter(x => x !== vis);
            }, 190);
          }
        }

        const { x, y } = cellToPixel(step.resultCell.row, step.resultCell.col);
        const gain = step.toValue * 5 * (i + 1); // combo bonus scales with chain depth
        state.score += gain;
        state.highestValueReached = Math.max(state.highestValueReached, step.toValue);
        state.queue.updateUnlockedFromValue(step.toValue);

        setTimeout(() => {
          // spawn the merged die visual
          const nv = {
            row: step.resultCell.row, col: step.resultCell.col, value: step.toValue,
            x, y, targetX: x, targetY: y,
            scale: 0.2, targetScale: 1.15, alpha: 1, id: visualId++, rotation: 0,
          };
          visualDice = visualDice.filter(v => !(v.row === step.resultCell.row && v.col === step.resultCell.col));
          visualDice.push(nv);
          animateScaleTo(nv, 1, 0.22, true);

          effects.mergeBurst(x, y, step.toValue, layout.cellSize);
          if (i > 0) {
            effects.comboText(x, y - layout.cellSize * 0.6, `COMBO x${i + 1}`, '#ff9a3c');
          }
          effects.scorePopup(x + layout.cellSize * 0.3, y - layout.cellSize * 0.4, gain);
          refreshScoreUI();

          if (state.score > state.best) {
            state.best = state.score;
            localStorage.setItem(BEST_KEY, String(state.best));
            refreshScoreUI();
          }

          if (step.toValue >= DICE_MAX_VALUE) {
            effects.celebrationBurst(layout.boardPx / 2, layout.boardPx / 2, layout.boardPx * 0.8, layout.boardPx * 0.6);
            window.Sound && window.Sound.superMerge();
          } else {
            window.Sound && window.Sound.merge(i, step.toValue);
          }

          if (i === steps.length - 1) {
            setTimeout(checkGameOver, 260);
          }
        }, 190);
      }, i * 260);
    });
  }

  function checkGameOver() {
    if (state.board.isFull() && !state.board.hasAnyMergeAvailable()) {
      triggerGameOver();
    }
  }

  function triggerGameOver() {
    state.gameOver = true;
    document.getElementById('final-score-value').textContent = state.score;
    const badge = document.getElementById('new-best-badge');
    const isNewBest = state.score >= state.best && state.score > 0;
    if (isNewBest) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    window.Sound && window.Sound.gameOver();
    if (isNewBest) {
      setTimeout(() => window.Sound && window.Sound.newBest(), 250);
    }
    setTimeout(() => {
      document.getElementById('overlay-gameover').classList.remove('hidden');
    }, 500);
    clearSave();
  }

  // ---------------- Power-ups ----------------
  function activatePower(key) {
    if (state.powerups[key] <= 0) return;
    if (key === 'undo') {
      performUndo();
      return;
    }
    state.activePower = state.activePower === key ? null : key;
    refreshPowerupUI();
  }

  function usePowerOnCell(row, col) {
    const key = state.activePower;
    if (!key) return false;
    if (key === 'bomb') {
      const cell = state.board.get(row, col);
      if (!cell) return false;
      pushHistory();
      window.Sound && window.Sound.bomb();
      state.board.clear(row, col);
      const vis = findVisual(row, col);
      const { x, y } = cellToPixel(row, col);
      effects.explosion(x, y, layout.cellSize);
      if (vis) {
        animateScaleTo(vis, 0, 0.15);
        animateAlphaTo(vis, 0, 0.15);
        setTimeout(() => { visualDice = visualDice.filter(v => v !== vis); }, 160);
      }
      state.powerups.bomb--;
      state.activePower = null;
      refreshPowerupUI();
      saveGame();
      return true;
    }
    if (key === 'cannon') {
      pushHistory();
      window.Sound && window.Sound.cannon();
      const { y } = cellToPixel(row, 0);
      const xStart = cellToPixel(row, 0).x - layout.cellSize / 2;
      const xEnd = cellToPixel(row, GRID_SIZE - 1).x + layout.cellSize / 2;
      for (let c = 0; c < GRID_SIZE; c++) {
        if (!state.board.isEmpty(row, c)) {
          state.board.clear(row, c);
          const vis = findVisual(row, c);
          if (vis) {
            animateScaleTo(vis, 0, 0.15);
            animateAlphaTo(vis, 0, 0.15);
            setTimeout(() => { visualDice = visualDice.filter(v => v !== vis); }, 160);
          }
        }
      }
      effects.cannonBlast(xStart, xEnd, y, layout.cellSize);
      state.powerups.cannon--;
      state.activePower = null;
      refreshPowerupUI();
      saveGame();
      return true;
    }
    return false;
  }

  // ---------------- Tiny tween helpers ----------------
  function animateScaleTo(obj, target, duration, bounce) {
    tweens.push({ obj, prop: 'scale', from: obj.scale, to: target, t: 0, duration, bounce: !!bounce });
  }
  function animateAlphaTo(obj, target, duration) {
    tweens.push({ obj, prop: 'alpha', from: obj.alpha, to: target, t: 0, duration });
  }
  let tweens = [];

  function updateTweens(dt) {
    tweens = tweens.filter(tw => {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.duration);
      let eased = p;
      if (tw.bounce) {
        eased = p < 1 ? 1 - Math.pow(1 - p, 3) : 1;
        if (p > 0.7) {
          const overshoot = Math.sin((p - 0.7) / 0.3 * Math.PI) * 0.08;
          tw.obj[tw.prop] = tw.to + overshoot;
          if (p >= 1) tw.obj[tw.prop] = tw.to;
          return p < 1;
        }
      }
      tw.obj[tw.prop] = tw.from + (tw.to - tw.from) * eased;
      if (p >= 1) tw.obj[tw.prop] = tw.to;
      return p < 1;
    });
  }

  // smoothing for visual dice position (spring-like follow)
  function updateVisualPositions(dt) {
    for (const v of visualDice) {
      if (v.targetX === undefined) continue;
      const speed = 14;
      v.x += (v.targetX - v.x) * Math.min(1, speed * dt);
      v.y += (v.targetY - v.y) * Math.min(1, speed * dt);
    }
  }

  // ---------------- Input handling ----------------
  function getPointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (evt.touches && evt.touches.length) {
      clientX = evt.touches[0].clientX; clientY = evt.touches[0].clientY;
    } else if (evt.changedTouches && evt.changedTouches.length) {
      clientX = evt.changedTouches[0].clientX; clientY = evt.changedTouches[0].clientY;
    } else {
      clientX = evt.clientX; clientY = evt.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onPointerDown(evt) {
    if (state.paused || state.gameOver || !state.started) return;
    if (state.activePower) return; // power-ups use their own tap handler on canvas
    const pos = getPointerPos(evt);
    beginDragLift(pos);
    evt.preventDefault();
  }

  function onPointerMove(evt) {
    if (drag.state !== 'dragging') return;
    const pos = getPointerPos(evt);
    drag.x = pos.x;
    drag.y = pos.y;
    const { row, col } = pixelToCell(pos.x, pos.y);
    if (state.board.inBounds(row, col) && state.board.isEmpty(row, col)) {
      drag.hoverCell = { row, col };
      drag.valid = true;
    } else {
      drag.hoverCell = state.board.inBounds(row, col) ? { row, col } : null;
      drag.valid = false;
    }
    evt.preventDefault();
  }

  function onPointerUp(evt) {
    if (drag.state !== 'dragging') return;
    if (drag.hoverCell && drag.valid) {
      tryPlaceDie(drag.hoverCell.row, drag.hoverCell.col, drag.value);
    } else if (drag.hoverCell) {
      window.Sound && window.Sound.invalid();
    }
    drag.state = 'idle';
    drag.hoverCell = null;
    dragCtx.clearRect(0, 0, dragCanvas.width, dragCanvas.height);
    evt.preventDefault();
  }

  // Picking up a die starts immediately on touch/press at the "next die" tray
  // slot — no long-press delay — then follows the finger until released.
  const nextDieEl = document.getElementById('next-queue');
  nextDieEl.addEventListener('mousedown', onPointerDown);
  nextDieEl.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp, { passive: false });
  window.addEventListener('touchcancel', onPointerUp, { passive: false });

  // Power-ups (bomb/cannon) still use a simple tap directly on the board.
  function onCanvasTap(evt) {
    if (!state.activePower) return;
    if (state.paused || state.gameOver || !state.started) return;
    const pos = getPointerPos(evt);
    const { row, col } = pixelToCell(pos.x, pos.y);
    if (state.board.inBounds(row, col)) usePowerOnCell(row, col);
    evt.preventDefault();
  }
  canvas.addEventListener('mousedown', onCanvasTap);
  canvas.addEventListener('touchstart', onCanvasTap, { passive: false });

  // ---------------- Drawing ----------------
  function drawBoard() {
    ctx.clearRect(0, 0, layout.boardPx, layout.boardPx);

    // frame
    if (boardImages.board_frame.complete) {
      ctx.drawImage(boardImages.board_frame, 0, 0, layout.boardPx, layout.boardPx);
    }

    // cells
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const x = layout.margin + c * layout.cellSize;
        const y = layout.margin + r * layout.cellSize;
        const pad = layout.cellSize * 0.06;
        let img = boardImages.cell_empty;
        if (drag.state === 'dragging' && drag.hoverCell && drag.hoverCell.row === r && drag.hoverCell.col === c) {
          img = drag.valid ? boardImages.cell_highlight : boardImages.cell_invalid;
        }
        if (state.activePower && (state.activePower === 'bomb' || state.activePower === 'cannon')) {
          const cell = state.board.get(r, c);
          if (state.activePower === 'bomb' && cell) img = boardImages.cell_highlight;
        }
        if (img && img.complete) {
          // cell sprites have baked-in transparent padding, so scale the
          // draw size up to compensate — the visible rounded square then
          // lands flush with the logical cellSize grid line.
          const spritePad = 10 / 200; // matches cell_empty/cell_invalid padding ratio
          const drawSize = layout.cellSize / (1 - spritePad * 2);
          const offset = (drawSize - layout.cellSize) / 2;
          ctx.drawImage(img, x - offset, y - offset, drawSize, drawSize);
        }
      }
    }

    // dice (sorted so dragged/animating ones draw naturally, back to front by row)
    const sorted = [...visualDice].sort((a, b) => a.row - b.row);
    for (const v of sorted) {
      drawDie(v.x, v.y, v.value, v.scale, v.alpha, v.rotation || 0);
    }

    effects.draw(ctx);
  }

  // Drag ghost is drawn on the separate full-viewport overlay canvas (not
  // the board canvas) so it renders above the HUD/tray and the grass
  // background instead of being clipped at the board's edges while the
  // player drags a die up from the tray.
  function drawDragOverlay() {
    dragCtx.clearRect(0, 0, dragCanvas.width, dragCanvas.height);
    if (drag.state !== 'dragging') return;

    const origin = trayDieOrigin();
    const p = drag.liftProgress;
    const eased = 1 - Math.pow(1 - p, 3);
    // drag.x/y are board-local; convert everything to viewport coordinates
    const originVX = origin.x + layout.viewportOffsetX;
    const originVY = origin.y + layout.viewportOffsetY;
    const dragVX = drag.x + layout.viewportOffsetX;
    const dragVY = drag.y + layout.viewportOffsetY;
    const gx = originVX + (dragVX - originVX) * eased;
    const gy = originVY + (dragVY - originVY) * eased;
    const lift = 26 * eased; // die floats above the finger
    const scale = 0.55 + 0.45 * eased;
    const size = layout.cellSize * DIE_FIT_RATIO * scale;

    // soft shadow beneath the floating die
    dragCtx.save();
    dragCtx.globalAlpha = 0.28 * eased;
    dragCtx.fillStyle = '#000';
    dragCtx.beginPath();
    dragCtx.ellipse(gx, gy + lift * 0.4 + size * 0.32, size * 0.32, size * 0.14, 0, 0, Math.PI * 2);
    dragCtx.fill();
    dragCtx.restore();

    dragCtx.save();
    dragCtx.globalAlpha = 0.98;
    const img = getDiceImage(drag.value);
    if (img.complete) {
      dragCtx.drawImage(img, gx - size / 2, gy - lift - size / 2, size, size);
    }
    dragCtx.restore();
  }

  // cell_empty.png has ~10px of transparent padding baked into its 200px
  // canvas on each side (visible square ≈ 181/200 of the sprite). Dice are
  // sized relative to that same ratio so they nest inside the drawn cell
  // background instead of overhanging its edges.
  const DIE_FIT_RATIO = 0.83;

  function drawDie(x, y, value, scale, alpha, rotation) {
    const img = getDiceImage(value);
    if (!img || !img.complete) return;
    const s = layout.cellSize * DIE_FIT_RATIO * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  // ---------------- Game loop ----------------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (!state.paused) {
      updateTweens(dt);
      updateVisualPositions(dt);
      effects.update(dt);
    }
    drawBoard();
    drawDragOverlay();
    requestAnimationFrame(loop);
  }

  // ---------------- Save / Load ----------------
  function saveGame() {
    try {
      const data = {
        board: state.board.toJSON(),
        queue: state.queue.toJSON(),
        score: state.score,
        powerups: state.powerups,
        highestValueReached: state.highestValueReached,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore quota errors */ }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state.board = Board.fromJSON(data.board);
      state.queue = DiceQueue.fromJSON(data.queue);
      state.score = data.score || 0;
      state.powerups = data.powerups || { bomb: 2, undo: 3, cannon: 1 };
      state.highestValueReached = data.highestValueReached || 1;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSave() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function flashMessage(msg) {
    // lightweight transient toast using a particle-like text in center of board
    effects.comboText(layout.boardPx / 2, layout.boardPx * 0.4, msg, '#ffffff');
  }

  // ---------------- Game lifecycle ----------------
  function newGame() {
    state.board = new Board(GRID_SIZE);
    state.queue = new DiceQueue(3);
    state.score = 0;
    state.powerups = { bomb: 2, undo: 3, cannon: 1 };
    state.activePower = null;
    state.gameOver = false;
    state.highestValueReached = 1;
    state.history = [];
    visualDice = [];
    effects.clear();
    clearSave();
    refreshQueueUI();
    refreshPowerupUI();
    refreshScoreUI();
  }

  function startGame(resumeIfSaved) {
    state.started = true;
    resize();
    if (resumeIfSaved && loadGame()) {
      syncVisualsFromBoard();
    } else {
      newGame();
    }
    refreshQueueUI();
    refreshPowerupUI();
    refreshScoreUI();
  }

  // expose minimal API for ui.js
  window.DiceMergeGame = {
    state,
    startGame,
    newGame,
    activatePower,
    resize,
    performUndo,
  };

  resize();
  window.addEventListener('DOMContentLoaded', () => {
    resize();
    if (visualDice.length === 0 && state.board.countEmpty && state.board.countEmpty() < GRID_SIZE * GRID_SIZE) {
      syncVisualsFromBoard();
    }
  });
  requestAnimationFrame(loop);
})();
