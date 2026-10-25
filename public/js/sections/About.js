// sections/About.js — mirrors the original `Dc` About class + `mc` smiley particle.
//   scroll p = (scrollY + vh − start) / (end − start) over [section top, section bottom + vh]
//   tick: sp += (p − sp) · 0.2 → --offset-y = (400 desktop | 200 ≤767) · (sp·2 − 1) px on the card
//   one-point-perspective "room": SVG lines from the section edges to the moving card's edges, rebuilt
//   only while p ≠ sp (12 divisions, 8 ≤767; 3 eased depth rings: d = 1 − (1 − g/4)²)
//   awards: IO threshold .5 adds .is-revealed once (mask wipes right, content slides in)
//   hover/touch an award → .is-active for 100ms + 10 smileys (5 ≤767) thrown on a canvas:
//   vx ±5, vy −5…−15, vr ±10°/f, gravity .45/f, size 48·a (a .25…1, +≤.01/f), removed below the section.
import { bus } from '../core/bus.js';
import { env, qs, qsa } from '../core/env.js';

function smileyImage(theme) {
  const c = document.createElement('canvas');
  c.width = c.height = 100;
  const x = c.getContext('2d');
  const s = getComputedStyle(document.documentElement);
  const ink = s.getPropertyValue('--color-secondary').trim() || '#0A0D00';
  const face = theme === 'contrasted' ? '#fff2ed' : (s.getPropertyValue('--color-primary').trim() || '#C6FF00');
  x.fillStyle = face; x.strokeStyle = ink; x.lineWidth = 4;
  x.beginPath(); x.arc(50, 50, 46, 0, Math.PI * 2); x.fill(); x.stroke();
  x.fillStyle = ink;
  x.beginPath(); x.ellipse(36, 40, 5, 8, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(64, 40, 5, 8, 0, 0, Math.PI * 2); x.fill();
  x.lineWidth = 5; x.lineCap = 'round';
  x.beginPath(); x.arc(50, 52, 24, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  return c;
}

class Smiley {
  constructor(ctx, image, x, y) {
    Object.assign(this, { ctx, image, width: 48, height: 48, x, y, r: 0 });
    this.a = 0.25 + Math.random() * 0.75;
    this.vx = (Math.random() * 2 - 1) * 5;
    this.vy = Math.random() * -10 - 5;
    this.vr = (Math.random() * 2 - 1) * 10;
    this.va = Math.random() * 0.01;
  }
  move() { this.vy += 0.45; this.x += this.vx; this.y += this.vy; this.r += this.vr; this.a += this.va; }
  draw() {
    const { ctx } = this, cx = this.x + this.width * 0.5 * this.a, cy = this.y + this.height * 0.5 * this.a;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((this.r * Math.PI) / 180); ctx.translate(-cx, -cy);
    ctx.drawImage(this.image, this.x, this.y, this.width * this.a, this.height * this.a);
    ctx.restore();
  }
}

export class About {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.inner = qs('.js-inner', el);
    this.svg = qs('.js-grid', el);
    this.path = qs('.js-path', el);
    this.canvas = qs('.js-canvas', el);
    this.ctx = this.canvas.getContext('2d');
    this.awards = qsa('.js-award', el);
    this.lines = [];
    this.smileys = [];
    this.isPaused = true;
    this.isForced = true;
    this.images = { default: smileyImage('default'), contrasted: smileyImage('contrasted') };
    this.setSize();
    this.setScroll();
    this.bindEvents();
    this.setLines();
    if (el.classList.contains('is-in-view')) { this.isPaused = false; bus.on('tick', this.tick, this); }
  }

  bindEvents() {
    bus.on('resize', this.onResize, this);
    bus.on('scroll', this.onScroll, this);
    bus.on('updateViewport', () => { this.setSize(); this.setScroll(); this.isForced = true; });
    bus.on('contrastchange', () => { this.images = { default: smileyImage('default'), contrasted: smileyImage('contrasted') }; });
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); }
    }), { threshold: 0.5 });
    this.awards.forEach((a) => {
      io.observe(a);
      const fn = () => this.onAwardInteraction(a);
      a.addEventListener('mouseenter', fn, { passive: true });
      a.addEventListener('touchstart', fn, { passive: true });
    });
    this.el.addEventListener('intersect', (e) => {
      this.isPaused = !e.detail.isIntersecting;
      if (this.isPaused) bus.off('tick', this.tick, this);
      else { this.isForced = true; bus.on('tick', this.tick, this); }
    });
  }

  onResize(widthChanged) { if (widthChanged) { this.setSize(); this.setScroll(); this.isForced = true; } }

  onScroll(y) {
    const s = this.scroll, b = y + window.innerHeight;
    s.p = b < s.start ? 0 : b > s.end ? 1 : (b - s.start) / (s.end - s.start);
  }

  onAwardInteraction(award) {
    award.classList.add('is-active');
    if (!env.reducedMotion) this.throwSmileys(award);
    setTimeout(() => award.classList.remove('is-active'), 100);
  }

  setSize() {
    const r = this.el.getBoundingClientRect();
    this.bounding = { left: r.left, top: r.top, width: this.el.clientWidth, height: this.el.clientHeight, innerWidth: this.inner.clientWidth, innerHeight: this.inner.clientHeight, offsetY: this.bounding ? this.bounding.offsetY : 0 };
    this.svg.style.width = `${this.bounding.width}px`;
    this.svg.style.height = `${this.bounding.height}px`;
    this.canvas.width = this.bounding.width;
    this.canvas.height = this.bounding.height;
  }

  setScroll() {
    const top = this.el.getBoundingClientRect().top + window.scrollY;
    this.scroll = { start: top, end: top + this.bounding.height + window.innerHeight, p: 0, sp: 0 };
    this.onScroll(window.scrollY);
    this.scroll.sp = this.scroll.p;
  }

  setLines() {
    const b = this.bounding;
    this.lines = [];
    const ox = (b.width - b.innerWidth) / 2;
    const oy = (b.height - b.innerHeight) / 2 + b.offsetY;
    const div = env.isDesktop ? 12 : 8, rings = 4;
    const gw = b.width / div, gh = b.height / div, iw = b.innerWidth / div, ih = b.innerHeight / div, step = 1 / rings;
    const O = { x1: 0, x2: b.width, y1: 0, y2: b.height };
    const I = { x1: ox, x2: ox + b.innerWidth, y1: oy, y2: oy + b.innerHeight };
    const diag = [[{ x: O.x1, y: O.y1 }, { x: I.x1, y: I.y1 }], [{ x: O.x2, y: O.y1 }, { x: I.x2, y: I.y1 }], [{ x: O.x2, y: O.y2 }, { x: I.x2, y: I.y2 }], [{ x: O.x1, y: O.y2 }, { x: I.x1, y: I.y2 }]];
    const at = (seg, d) => ({ x: seg[0].x + (seg[1].x - seg[0].x) * d, y: seg[0].y + (seg[1].y - seg[0].y) * d });
    for (let g = 1; g < div; g++) {
      this.lines.push([{ x: gw * g, y: O.y1 }, { x: ox + iw * g, y: I.y1 }]);
      this.lines.push([{ x: gw * g, y: O.y2 }, { x: ox + iw * g, y: I.y2 }]);
    }
    for (let g = 1; g < rings; g++) { const d = 1 - (1 - step * g) ** 2; this.lines.push([at(diag[0], d), at(diag[1], d)]); }
    for (let g = 1; g < rings; g++) { const d = 1 - (1 - step * g) ** 2; this.lines.push([at(diag[3], d), at(diag[2], d)]); }
    for (let g = 0; g <= div; g++) {
      this.lines.push([{ x: O.x1, y: gh * g }, { x: I.x1, y: oy + ih * g }]);
      this.lines.push([{ x: O.x2, y: gh * g }, { x: I.x2, y: oy + ih * g }]);
    }
    for (let g = 1; g < rings; g++) { const d = 1 - (1 - step * g) ** 2; this.lines.push([at(diag[1], d), at(diag[2], d)]); }
    for (let g = 1; g < rings; g++) { const d = 1 - (1 - step * g) ** 2; this.lines.push([at(diag[0], d), at(diag[3], d)]); }
    this.drawLines();
  }

  drawLines() {
    let d = '';
    for (const [a, b] of this.lines) d += `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)} `;
    this.path.setAttribute('d', d);
  }

  throwSmileys(award) {
    const theme = document.documentElement.classList.contains('theme-contrasted') ? 'contrasted' : 'default';
    const s = this.el.getBoundingClientRect(), a = award.getBoundingClientRect();
    const x = a.left + a.width * 0.5 - s.left, y = a.top + a.height * 0.5 - s.top;
    const n = env.isDesktop ? 10 : 5;
    for (let i = 0; i < n; i++) this.smileys.push(new Smiley(this.ctx, this.images[theme], x, y));
  }

  tick() {
    const { scroll: s, bounding: b } = this;
    s.sp += (s.p - s.sp) * 0.2;
    const diff = Math.round((s.p - s.sp) * 1000) / 1000;
    b.offsetY = (env.isDesktop ? 400 : 200) * (s.sp * 2 - 1);
    if (env.reducedMotion) b.offsetY = 0;
    this.el.style.setProperty('--offset-y', `${b.offsetY}px`);
    if (diff !== 0 || this.isForced) this.setLines();
    if (this.smileys.length) {
      this.smileys = this.smileys.filter((sm) => { sm.move(); return sm.y <= b.height; });
      this.ctx.clearRect(0, 0, b.width, b.height);
      this.smileys.forEach((sm) => sm.draw());
      if (!this.smileys.length) this.ctx.clearRect(0, 0, b.width, b.height);
    }
    this.isForced = false;
  }
}
