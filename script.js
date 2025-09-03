(() => {
  // DOM Elements
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const energyEl = document.getElementById("energy");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const powerStateEl = document.getElementById("powerState");
  const pauseBtn = document.getElementById("pauseBtn");

  // Constants
  const BEST_KEY = "charge_runner_best_v1";
  let BEST = parseInt(localStorage.getItem(BEST_KEY)) || 0;
  bestEl.textContent = BEST;

  const W = canvas.width;
  const H = canvas.height;
  const LANE_COUNT = 3;
  const lanes = [W * 0.25, W * 0.5, W * 0.75];

  // Player
  const player = {
    lane: 1,
    x: lanes[1],
    y: H - 110,
    w: 56,
    h: 76,
    color: "#00ffcc",
  };

  // Game state
  let running = false;
  let paused = false;
  let score = 0;
  let energy = 100;
  let speed = 260;
  let spawnTimer = 0;
  let obstacles = [];
  let pickups = [];
  let negatives = [];
  let power = null; // { name, expires }
  let time = 0;
  let lastTime = 0;

  // Touch state
  let touchStartX = null;

  // --- Input Handling ---
  let inputLeft = false;
  let inputRight = false;

  document.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") moveLeft();
    if (e.code === "ArrowRight" || e.code === "KeyD") moveRight();
    if (e.code === "Space") handleStart();
    if (e.code === "KeyP") togglePause();
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD", "Space", "KeyP"].includes(e.code)) {
      e.preventDefault();
    }
  });

  canvas.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
  });

  canvas.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -30) moveRight();
    else if (dx > 30) moveLeft();
    touchStartX = null;
  });

  canvas.addEventListener("click", handleStart);

  function moveLeft() {
    if (player.lane > 0) {
      player.lane--;
      player.x = lanes[player.lane];
    }
  }

  function moveRight() {
    if (player.lane < LANE_COUNT - 1) {
      player.lane++;
      player.x = lanes[player.lane];
    }
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
    if (!paused) requestAnimationFrame(loop);
  }

  pauseBtn.addEventListener("click", togglePause);

  // --- Game Logic ---
  function start() {
    if (running) return;
    createStartScreen(false);
    resetGame();
    running = true;
    paused = false;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function resetGame() {
    score = 0;
    energy = 100;
    speed = 260;
    spawnTimer = 0;
    obstacles = [];
    pickups = [];
    negatives = [];
    power = null;
    time = 0;
    updateHUD();
    clearPower();
  }

  function spawn() {
    const r = Math.random();
    const lane = Math.floor(Math.random() * LANE_COUNT);
    const x = lanes[lane];

    if (r < 0.18) {
      // Positive charge
      pickups.push({
        lane,
        x,
        y: -40,
        size: 28,
        vy: 120 + Math.random() * 40,
      });
    } else if (r < 0.34) {
      // Negative charge
      negatives.push({
        lane,
        x,
        y: -40,
        size: 28,
        vy: 160 + Math.random() * 60,
      });
    } else {
      // Obstacle
      obstacles.push({
        lane,
        x,
        y: -120,
        w: 56,
        h: 60,
        vy: 180 + Math.random() * 80,
      });
    }
  }

  function activatePower(name, duration = 3000) {
    power = { name, expires: performance.now() + duration };
    powerStateEl.textContent = `Power: ${name}`;
    if (name === "Shield") drawShieldIndicator();
  }

  function clearPower() {
    power = null;
    powerStateEl.textContent = "Power: —";
  }

  function updateHUD() {
    energyEl.textContent = Math.max(0, Math.floor(energy));
    scoreEl.textContent = score;
    bestEl.textContent = BEST;
  }

  function loop(timestamp) {
    if (!running || paused) return;

    const dt = Math.min(0.034, (timestamp - lastTime) / 1000);
    lastTime = timestamp;

    time += dt * 1000;

    // Difficulty ramp
    if (time % 4000 < dt * 1000) {
      speed += 8;
    }

    // Spawning
    spawnTimer -= dt * 1000;
    const interval = Math.max(350, 800 - Math.floor(score / 5) * 10);
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = interval;
    }

    // Move objects
    moveObjects(dt);

    // Collisions
    checkCollisions();

    // Magnet power effect
    if (power && power.name === "Magnet" && power.expires > performance.now()) {
      for (const p of pickups) {
        if (Math.abs(p.x - player.x) < 120) {
          p.y += 40 * dt * 60;
        }
      }
    } else if (power && power.expires <= performance.now()) {
      clearPower();
    }

    // Passive energy drain
    if (time % 200 < dt * 1000) {
      energy -= 0.2;
      if (energy <= 0) endGame();
    }

    render();
    requestAnimationFrame(loop);
  }

  function moveObjects(dt) {
    const factor = dt * 60;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.y += p.vy * factor * 0.016;
      if (p.y > H + 40) pickups.splice(i, 1);
    }
    for (let i = negatives.length - 1; i >= 0; i--) {
      const n = negatives[i];
      n.y += n.vy * factor * 0.016;
      if (n.y > H + 40) negatives.splice(i, 1);
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.y += o.vy * factor * 0.016;
      if (o.y > H + 60) obstacles.splice(i, 1);
    }
  }

  function checkCollisions() {
    // Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (collides(p)) {
        pickups.splice(i, 1);
        score += 3;
        energy = Math.min(100, energy + 12);
        if (Math.random() < 0.12) activatePower("Magnet", 6000);
        updateHUD();
      }
    }

    // Negatives
    for (let i = negatives.length - 1; i >= 0; i--) {
      const n = negatives[i];
      if (collides(n)) {
        negatives.splice(i, 1);
        score = Math.max(0, score - 4);
        energy -= 18;
        updateHUD();
        if (energy <= 0) endGame();
      }
    }

    // Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (collides(o)) {
        if (power && power.name === "Shield") {
          obstacles.splice(i, 1);
          clearPower();
          score += 1;
        } else {
          endGame();
        }
      }
    }
  }

  function collides(obj) {
    return (
      obj.lane === player.lane &&
      obj.y + (obj.size || obj.h) > player.y - 10 &&
      obj.y < player.y + player.h
    );
  }

  function endGame() {
    running = false;
    BEST = Math.max(BEST, score);
    localStorage.setItem(BEST_KEY, BEST);
    updateHUD();
    showGameOver();
  }

  function showGameOver() {
    const template = document.getElementById("game-over-template");
    const frag = document.importNode(template.content, true);
    frag.getElementById("final-score").textContent = score;
    frag.getElementById("final-best").textContent = BEST;
    frag.getElementById("restart-final").onclick = () => {
      document.body.removeChild(modal);
      start();
    };

    const modal = document.createElement("div");
    modal.className = "overlay";
    modal.appendChild(frag);
    document.body.appendChild(modal);
  }

  // --- Rendering ---
  function render() {
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#041226";
    ctx.fillRect(0, 0, W, H);

    // Lane lines
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x of lanes) {
      ctx.beginPath();
      ctx.moveTo(x - 28, 0);
      ctx.lineTo(x - 28, H);
      ctx.stroke();
    }

    // Draw objects
    for (const p of pickups) drawCircle(p.x, p.y, p.size / 2, "#38ef7d");
    for (const n of negatives) drawCircle(n.x, n.y, n.size / 2, "#ff5c8a");
    for (const o of obstacles) drawRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h, "#ffcc66");

    // Player battery
    drawBattery(player.x, player.y, player.w, player.h);

    // Energy bar
    drawEnergyBar();

    // HUD overlay
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(12, H - 54, 180, 38);
    ctx.fillStyle = "#00ffcc";
    ctx.font = "14px monospace";
    ctx.fillText("Charge Runner ⚡", 22, H - 32);
  }

  function drawCircle(x, y, r, color) {
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRect(x, y, w, h, color) {
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function drawBattery(x, y, w, h) {
    ctx.save();
    ctx.translate(x - w / 2, y - h / 2);

    // Body
    ctx.fillStyle = "#0a2b2a";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.strokeRect(0, 0, w, h);

    // Terminals
    ctx.fillStyle = "#00ffcc";
    ctx.fillRect(w - 6, h * 0.25, 6, h * 0.5);

    // Charge level
    const innerW = (w - 8) * (energy / 100);
    ctx.fillStyle = energy > 50 ? "#38ef7d" : energy > 20 ? "#ffcc00" : "#ff5c8a";
    ctx.fillRect(4, 4, Math.max(2, innerW), h - 8);

    // Accent
    ctx.fillStyle = "#00ffcc";
    ctx.fillRect(w * 0.18, h * 0.18, w * 0.14, h * 0.64);

    ctx.restore();
  }

  function drawEnergyBar() {
    const x = W - 220;
    const y = 18;
    const w = 200;
    const h = 12;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = energy > 50 ? "#38ef7d" : energy > 20 ? "#ffcc00" : "#ff5c8a";
    ctx.fillRect(x, y, w * (energy / 100), h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.strokeRect(x, y, w, h);
  }

  function drawShieldIndicator() {
    const x = player.x;
    const y = player.y + player.h / 2;
    ctx.save();
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#00ffcc";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x, y, 40 + i * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Start Screen ---
  function createStartScreen(show = true) {
    const el = document.getElementById("start-screen");
    if (show && !el) {
      const screen = document.createElement("div");
      screen.id = "start-screen";
      screen.innerHTML = `
        <h1>⚡ Charge Runner</h1>
        <p>Collect green charges, avoid red ones, and dodge obstacles.<br>Use power-ups to survive longer!</p>
      `;
      document.body.appendChild(screen);
    } else if (!show && el) {
      el.remove();
    }
  }

  function handleStart() {
    if (!running) start();
  }

  // Show start screen
  createStartScreen(true);
})();
