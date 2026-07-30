/* effects.js — particle system: sparks, rings, confetti, floating score text */

const PARTICLE_IMAGES = {};
function loadEffectImages() {
  const names = ['spark', 'ring', 'smoke', 'star',
    'confetti_0', 'confetti_1', 'confetti_2', 'confetti_3', 'confetti_4', 'confetti_5'];
  for (const n of names) {
    const img = new Image();
    img.src = `assets/particles/${n}.png`;
    PARTICLE_IMAGES[n] = img;
  }
  for (const v of [1, 2, 3, 4, 5, 6, 10]) {
    const img = new Image();
    img.src = `assets/particles/glow_${v}.png`;
    PARTICLE_IMAGES[`glow_${v}`] = img;
  }
}

class Particle {
  constructor(opts) {
    Object.assign(this, {
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
      rotation: 0, vrot: 0,
      scale: 1, scaleVel: 0,
      alpha: 1, alphaVel: 0,
      life: 1, maxLife: 1,
      image: null,
      color: null,
      size: 20,
      kind: 'sprite', // 'sprite' | 'text' | 'circle'
      text: '',
      font: 'bold 22px sans-serif',
    }, opts);
  }

  update(dt) {
    this.vx += this.ax * dt;
    this.vy += this.ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += this.vrot * dt;
    this.scale += this.scaleVel * dt;
    this.alpha = Math.max(0, this.alpha + this.alphaVel * dt);
    this.life -= dt;
    return this.life > 0 && this.alpha > 0.01;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    if (this.kind === 'sprite' && this.image) {
      const s = this.size * this.scale;
      ctx.drawImage(this.image, -s / 2, -s / 2, s, s);
    } else if (this.kind === 'text') {
      ctx.font = this.font;
      ctx.fillStyle = this.color || '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(this.text, 0, 0);
      ctx.fillText(this.text, 0, 0);
    } else if (this.kind === 'circle') {
      ctx.beginPath();
      ctx.fillStyle = this.color || '#fff';
      ctx.arc(0, 0, this.size * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

class EffectSystem {
  constructor() {
    this.particles = [];
    this.shockwaves = []; // {x,y,r,maxR,alpha,life}
  }

  update(dt) {
    this.particles = this.particles.filter(p => p.update(dt));
    this.shockwaves = this.shockwaves.filter(s => {
      if (s.delay && s.delay > 0) {
        s.delay -= dt;
        return true; // still waiting to start, keep it around
      }
      s.r += s.speed * dt;
      s.alpha -= s.fade * dt;
      return s.alpha > 0.01 && s.r < s.maxR;
    });
  }

  draw(ctx) {
    for (const s of this.shockwaves) {
      if (s.delay && s.delay > 0) continue; // not started yet
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of this.particles) p.draw(ctx);
  }

  addShockwave(x, y, { color = 'rgba(255,220,120,0.9)', maxR = 120, speed = 260, width = 6, fade = 2.2 } = {}) {
    this.shockwaves.push({ x, y, r: 4, maxR, speed, color, width, fade, alpha: 1 });
  }

  // Radar ping: bright cyan-white core flash + two staggered expanding
  // rings that fade as they grow — the "active radar" pulse used when
  // tiles merge.
  radarPing(x, y, cellSize, color = '96, 226, 255') {
    // bright core flash
    this.particles.push(new Particle({
      x, y, kind: 'circle', color: `rgba(${color}, 0.85)`,
      size: cellSize * 0.42, scale: 1, scaleVel: 1.6,
      alpha: 0.85, alphaVel: -3.2, life: 0.28,
    }));
    // soft outer glow behind the rings
    const glowImg = PARTICLE_IMAGES['glow_1'];
    if (glowImg) {
      this.particles.push(new Particle({
        x, y, image: glowImg, kind: 'sprite',
        size: cellSize * 1.4, scale: 0.4, scaleVel: 1.6,
        alpha: 0.6, alphaVel: -2.4, life: 0.35,
      }));
    }
    // two rings, staggered, so the pulse reads as a continuous radar ping
    // rather than a single ring
    this.shockwaves.push({
      x, y, r: cellSize * 0.15, maxR: cellSize * 1.7,
      speed: cellSize * 3.6, color: `rgba(${color}, 0.95)`, width: 4, fade: 2.0, alpha: 1,
    });
    this.shockwaves.push({
      x, y, r: cellSize * 0.15, maxR: cellSize * 1.7,
      speed: cellSize * 3.6, color: `rgba(${color}, 0.55)`, width: 8, fade: 2.6, alpha: 0.7,
      delay: 0.08,
    });
  }

  // Merge burst: sparks radiating out + glow flash + radar-ping ring
  mergeBurst(x, y, value, cellSize) {
    const glowIndex = value >= 10 ? 10 : Math.min(value, 6);
    const glowImg = PARTICLE_IMAGES[`glow_${glowIndex}`] || PARTICLE_IMAGES['glow_1'];
    this.particles.push(new Particle({
      x, y, image: glowImg, kind: 'sprite',
      size: cellSize * 1.6, scale: 0.3, scaleVel: 2.2,
      alpha: 0.9, alphaVel: -2.6, life: 0.5, maxLife: 0.5,
    }));

    const sparkCount = 10 + Math.min(value, 6);
    for (let i = 0; i < sparkCount; i++) {
      const ang = (Math.PI * 2 * i) / sparkCount + Math.random() * 0.3;
      const speed = 90 + Math.random() * 140;
      this.particles.push(new Particle({
        x, y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        ax: -Math.cos(ang) * speed * 0.6, ay: -Math.sin(ang) * speed * 0.6 + 120,
        image: PARTICLE_IMAGES['spark'], kind: 'sprite',
        size: 18 + Math.random() * 14, scale: 1, scaleVel: -0.8,
        rotation: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 6,
        alpha: 1, alphaVel: -1.8, life: 0.6 + Math.random() * 0.3,
      }));
    }
    this.radarPing(x, y, cellSize);
  }

  // Combo chain text popup
  comboText(x, y, text, color = '#ffe066') {
    this.particles.push(new Particle({
      x, y, kind: 'text', text, color,
      font: 'bold 26px "GameFont", sans-serif',
      vy: -60, ay: -20,
      scale: 0.6, scaleVel: 1.4,
      alpha: 1, alphaVel: -1.1, life: 1.0,
    }));
  }

  // Floating score number (+10 etc.)
  scorePopup(x, y, amount) {
    this.particles.push(new Particle({
      x, y, kind: 'text', text: `+${amount}`, color: '#ffffff',
      font: 'bold 20px "GameFont", sans-serif',
      vy: -50, alpha: 1, alphaVel: -1.4, life: 0.8,
    }));
  }

  // Explosion effect for bomb power-up
  explosion(x, y, cellSize) {
    this.particles.push(new Particle({
      x, y, image: PARTICLE_IMAGES['smoke'], kind: 'sprite',
      size: cellSize * 2, scale: 0.4, scaleVel: 1.6,
      alpha: 0.85, alphaVel: -1.6, life: 0.6,
    }));
    for (let i = 0; i < 18; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 200;
      const colorIdx = Math.floor(Math.random() * 6);
      this.particles.push(new Particle({
        x, y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 60,
        ay: 400,
        vrot: (Math.random() - 0.5) * 10,
        image: PARTICLE_IMAGES[`confetti_${colorIdx}`], kind: 'sprite',
        size: 14 + Math.random() * 10,
        alpha: 1, alphaVel: -1.2, life: 0.9 + Math.random() * 0.4,
      }));
    }
    this.addShockwave(x, y, { color: 'rgba(255,140,80,0.9)', maxR: cellSize * 1.3, speed: cellSize * 4, width: 8 });
  }

  // Cannon blast along a row
  cannonBlast(xStart, xEnd, y, cellSize) {
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = xStart + (xEnd - xStart) * t;
      this.particles.push(new Particle({
        x, y, image: PARTICLE_IMAGES['smoke'], kind: 'sprite',
        size: cellSize * 1.3, scale: 0.5 + Math.random() * 0.3, scaleVel: 1.2,
        alpha: 0.7, alphaVel: -1.5, life: 0.5,
      }));
    }
    for (let i = 0; i < 24; i++) {
      const x = xStart + Math.random() * (xEnd - xStart);
      const colorIdx = Math.floor(Math.random() * 6);
      this.particles.push(new Particle({
        x, y: y + (Math.random() - 0.5) * cellSize * 0.5,
        vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 150,
        ay: 400, vrot: (Math.random() - 0.5) * 8,
        image: PARTICLE_IMAGES[`confetti_${colorIdx}`], kind: 'sprite',
        size: 12 + Math.random() * 8,
        alpha: 1, alphaVel: -1.3, life: 0.8,
      }));
    }
  }

  // Victory confetti burst (max die reached / big combo)
  celebrationBurst(cx, cy, w, h) {
    for (let i = 0; i < 60; i++) {
      const colorIdx = Math.floor(Math.random() * 6);
      this.particles.push(new Particle({
        x: cx + (Math.random() - 0.5) * w,
        y: cy - h / 2 - 20,
        vx: (Math.random() - 0.5) * 120,
        vy: 60 + Math.random() * 80,
        ay: 220,
        vrot: (Math.random() - 0.5) * 10,
        image: PARTICLE_IMAGES[`confetti_${colorIdx}`], kind: 'sprite',
        size: 12 + Math.random() * 10,
        alpha: 1, alphaVel: -0.4, life: 2.5 + Math.random(),
      }));
    }
  }

  clear() {
    this.particles = [];
    this.shockwaves = [];
  }
}

if (typeof module !== 'undefined') module.exports = { EffectSystem };
