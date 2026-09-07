// ============================================================
// ambient.js — Rain canvas + CRT vignette (dark mode only)
// ============================================================

(function () {
  let canvas, ctx, animFrame;
  let drops = [];
  let lightningLoopStarted = false;
  const DROP_COUNT = 150;

  // ── RAIN ──────────────────────────────────────────────────

  function createDrops() {
    drops = [];
    for (let i = 0; i < DROP_COUNT; i++) {
      drops.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        length: 10 + Math.random() * 25,
        speed: 6 + Math.random() * 12,
        opacity: 0.15 + Math.random() * 0.25,
        width: 0.5 + Math.random() * 1.5
      });
    }
  }

  function drawRain() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const d of drops) {
      const grad = ctx.createLinearGradient(d.x, d.y, d.x - 1, d.y + d.length);
      grad.addColorStop(0, `rgba(0, 212, 255, 0)`);
      grad.addColorStop(1, `rgba(0, 212, 255, ${d.opacity})`);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 1, d.y + d.length);
      ctx.strokeStyle = grad;
      ctx.lineWidth = d.width;
      ctx.stroke();
      d.y += d.speed;
      if (d.y > canvas.height + d.length) {
        d.y = -d.length;
        d.x = Math.random() * canvas.width;
      }
    }
    animFrame = requestAnimationFrame(drawRain);
  }

  function startRain() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'rain-canvas';
    canvas.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none; z-index: 10;
    `;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvas();
    createDrops();
    drawRain();
    window.addEventListener('resize', resizeCanvas);
  }

  function stopRain() {
    if (!canvas) return;
    cancelAnimationFrame(animFrame);
    canvas.remove();
    canvas = null;
    ctx = null;
    window.removeEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    createDrops();
  }

  // ── VIGNETTE ──────────────────────────────────────────────

  function initVignette() {
    if (document.getElementById('crt-vignette')) return;
    const v = document.createElement('div');
    v.id = 'crt-vignette';
    v.style.cssText = `
      position: fixed; inset: 0;
      pointer-events: none; z-index: 0;
      background: radial-gradient(
        ellipse at center,
        transparent 50%,
        rgba(0,0,0,0.25) 78%,
        rgba(0,0,0,0.60) 100%
      );
      display: none;
    `;
    document.body.appendChild(v);
  }

  function setVignette(on) {
    const v = document.getElementById('crt-vignette');
    if (v) v.style.display = on ? 'block' : 'none';
  }

  // ── LIGHTNING ─────────────────────────────────────────────

  function initLightning() {
    document.querySelectorAll('.users-panel, .auth-container').forEach(panel => {
      if (panel.querySelector('.lightning-bolt')) return;
      const bolt = document.createElement('div');
      bolt.className = 'lightning-bolt';
      bolt.style.cssText = `
        position: absolute; top: -3px; left: 15%;
        width: 70%; height: 3px;
        background: linear-gradient(90deg, transparent 0%, #00D4FF 30%, #ffffff 50%, #00D4FF 70%, transparent 100%);
        opacity: 0; pointer-events: none; z-index: 999; border-radius: 2px;
        box-shadow: 0 0 8px #00D4FF, 0 0 20px #fff, 0 0 40px #00D4FF;
      `;
      panel.appendChild(bolt);
    });
  }

  function triggerLightning() {
  if (document.body.classList.contains('light-theme')) return;

  const flash = document.createElement('div');
  flash.style.cssText = `
    position: fixed; inset: 0;
    pointer-events: none; z-index: 999;
    background: radial-gradient(ellipse at 50% 0%, 
      rgba(180, 240, 255, 0.18) 0%, 
      rgba(0, 212, 255, 0.06) 40%, 
      transparent 70%
    );
    opacity: 0;
  `;
  document.body.appendChild(flash);

  // Chớp nhanh 2 lần
  flash.style.opacity = '1';
  setTimeout(() => { flash.style.opacity = '0.2'; }, 60);
  setTimeout(() => { flash.style.opacity = '0.8'; }, 100);
  setTimeout(() => { flash.style.opacity = '0';   }, 160);
  setTimeout(() => { flash.style.opacity = '0.5'; }, 220);
  setTimeout(() => { flash.style.opacity = '0';   flash.remove(); }, 320);
}

  function startLightningLoop() {
    setTimeout(function loop() {
      triggerLightning();
      setTimeout(loop, 8000);
    }, 7110);
  }

  // ── PUBLIC API ────────────────────────────────────────────

  window.setAmbientDark = function (isDark) {
    if (isDark) {
      startRain();
      setVignette(true);
      if (!lightningLoopStarted) {
        lightningLoopStarted = true;
        startLightningLoop();
      }
    } else {
      stopRain();
      setVignette(false);
      lightningLoopStarted = false;
    }
  };

  window.triggerLightning = triggerLightning;

  // ── INIT ──────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    initVignette();
    initLightning();
    // const isDark = !document.body.classList.contains('light-theme');
    // setAmbientDark(isDark);
  });

})();