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
      if (panel.querySelector('.lightning-svg')) return;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.className = 'lightning-svg';
      svg.style.cssText = `
      position: absolute;
      top: -120px;
      left: 30%;
      width: 60px;
      height: 130px;
      pointer-events: none;
      z-index: 999;
      opacity: 0;
      overflow: visible;
    `;

      // Zigzag path — tia sét đánh xuống
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M30,0 L18,45 L28,45 L10,110 L22,110 L0,200');
      path.setAttribute('stroke', '#00D4FF');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('filter', 'url(#glow)');

      // Glow filter
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
      <filter id="lightning-glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    `;
      path.setAttribute('filter', 'url(#lightning-glow)');

      svg.appendChild(defs);
      svg.appendChild(path);

      // Thêm white core (tia trắng mỏng bên trong)
      const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      core.setAttribute('d', 'M30,0 L18,45 L28,45 L10,110 L22,110 L0,200');
      core.setAttribute('stroke', 'white');
      core.setAttribute('stroke-width', '0.8');
      core.setAttribute('fill', 'none');
      core.setAttribute('opacity', '0.9');
      svg.appendChild(core);

      panel.appendChild(svg);
    });
  }

  // Thay hàm triggerLightning
  function triggerLightning() {
    if (document.body.classList.contains('light-theme')) return;

    // Random hóa path mỗi lần — tia sét không bao giờ giống nhau
    const bolts = document.querySelectorAll('.lightning-svg');
    bolts.forEach(svg => {
      const paths = svg.querySelectorAll('path');
      const x = 20 + Math.random() * 20; // random x position
      const newD = `M${x},0 L${x - 10},${35 + Math.random() * 15} L${x + 8},${35 + Math.random() * 15} L${x - 14},${90 + Math.random() * 15} L${x + 6},${90 + Math.random() * 15} L${x - 5},200`;
      paths.forEach(p => p.setAttribute('d', newD));
    });

    // Flash toàn màn hình nhẹ (giữ nguyên cái này)
    const flash = document.createElement('div');
    flash.style.cssText = `
    position: fixed; inset: 0;
    pointer-events: none; z-index: 999;
    background: radial-gradient(ellipse at 50% 0%,
      rgba(180,240,255,0.15) 0%,
      rgba(0,212,255,0.05) 40%,
      transparent 70%
    );
    opacity: 0;
  `;
    document.body.appendChild(flash);

    // Animate tia sét
    bolts.forEach(svg => {
      svg.style.opacity = '0';
      setTimeout(() => { svg.style.opacity = '1'; flash.style.opacity = '1'; }, 0);
      setTimeout(() => { svg.style.opacity = '0.4'; flash.style.opacity = '0.3'; }, 60);
      setTimeout(() => { svg.style.opacity = '1'; flash.style.opacity = '0.8'; }, 100);
      setTimeout(() => { svg.style.opacity = '0.2'; flash.style.opacity = '0.1'; }, 160);
      setTimeout(() => { svg.style.opacity = '0.9'; flash.style.opacity = '0.6'; }, 200);
      setTimeout(() => { svg.style.opacity = '0'; flash.style.opacity = '0'; flash.remove(); }, 300);
    });
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
      initLightning(); 
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
  });

})();