// sections/Contact.js — mirrors the original `bc` CTA class (motion-notes §7 "CTA").
//  • spring grid: SVG grid, 12 (8 ≤767) columns, rows of container-height/8.
//  • idle loop: timeline repeat −1, repeatDelay .5: GO text scale .85→1.05 (2.7s power2.in) → wavePulse()
//    (ring +15px/f, strength 1; 10 / .35 ≤767) → scale .85 (.15s power4.out).
//  • points within 30px of the ring get a radial impulse; spring k .001, damping .9.
//  • hover/focus GO: pulse pauses, after 600ms a SHOCK wave (speed 30, strength 5); wave.op 0→1
//    (.3s delay, 1.2s expo.inOut) fades in a static fisheye bulge; CSS irises the 64rem disc open
//    (clip-path circle 0→50%, 1s snap, .2s delay) and LET'S / ROCK settle in with bobbing slices.
//  • leave: op → 0 (.7s expo.inOut), loop restarts.
// Changes: GO is a real <button> (keyboard + aria-expanded); the disc holds two links ("Start a project"
// → the new enquiry form, "Book a call" → /book) instead of an obfuscated mailto; Esc closes.
import { bus } from '../core/bus.js';
import { env, qs, qsa } from '../core/env.js';

export class Contact {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.container = qs('.js-container', el);
    this.hover = qs('.js-hover', el);
    this.button = qs('.js-button', el);
    this.cta = qs('.js-cta', el);
    this.links = qsa('.js-cta-link', el);
    this.grid = { el: qs('.js-grid', el), svg: qs('.js-grid-svg', el), path: qs('.js-grid-path', el), points: [] };
    this.wave = { progress: 0, op: 0, speed: env.isDesktop ? 15 : 10, strength: env.isDesktop ? 1 : 0.35, state: 'paused', timeout: 0 };
    this.isActive = false;
    this.setSize();
    this.setGrid();
    this.drawLines();
    this.createPulseTimeline();
    this.bindEvents();
  }

  bindEvents() {
    bus.on('resize', this.onResize, this);
    bus.on('updateViewport', () => { this.setSize(); this.setGrid(); this.drawLines(); });
    this.hover.addEventListener('mouseenter', (e) => this.onHover(e));
    this.button.addEventListener('focus', (e) => this.onHover(e));
    this.button.addEventListener('click', (e) => { if (this.isActive && e.detail === 0) this.links[0].focus(); else this.onHover(e); });
    this.hover.addEventListener('mouseleave', () => this.onOut());
    this.el.addEventListener('touchstart', (e) => { if (!this.hover.contains(e.target)) this.onOut(); }, { passive: true });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isActive) { this.onOut(); this.button.focus(); } });
    this.el.addEventListener('focusout', () => setTimeout(() => { if (!this.el.contains(document.activeElement)) this.onOut(); }, 0));
    this.links[0].addEventListener('click', (e) => {
      e.preventDefault();
      const form = qs('#enquiry');
      this.app.scrollTo(form);
      setTimeout(() => qs('#f-name') && qs('#f-name').focus({ preventScroll: true }), env.reducedMotion ? 0 : 1300);
    });
    this.el.addEventListener('intersect', (e) => {
      if (env.reducedMotion) return;
      if (e.detail.isIntersecting) { bus.on('tick', this.tick, this); this.tl && !this.isActive && this.tl.play(); }
      else { bus.off('tick', this.tick, this); this.tl && this.tl.pause(); if (this.isActive) this.onOut(); }
    });
  }

  onResize(widthChanged) { if (widthChanged) { this.setSize(); this.setGrid(); this.drawLines(); } }

  onHover(e) {
    if (this.isActive) return;
    this.isActive = true;
    this.hover.classList.add('is-active');
    this.button.setAttribute('aria-expanded', 'true');
    this.links.forEach((l) => l.removeAttribute('tabindex'));
    if (env.reducedMotion || !env.gsap) { this.wave.op = 1; this.drawLines(); return; }
    this.tl && this.tl.pause();
    clearTimeout(this.wave.timeout);
    this.wave.timeout = setTimeout(() => this.waveShock(), 600);
    env.gsap.to(this.wave, { op: 1, delay: 0.3, duration: 1.2, ease: 'expo.inOut', overwrite: true });
    e && e.stopPropagation && e.stopPropagation();
  }

  onOut() {
    if (!this.isActive) return;
    this.isActive = false;
    clearTimeout(this.wave.timeout);
    this.hover.classList.remove('is-active');
    this.button.setAttribute('aria-expanded', 'false');
    this.links.forEach((l) => l.setAttribute('tabindex', '-1'));
    if (env.reducedMotion || !env.gsap) { this.wave.op = 0; this.drawLines(); return; }
    this.tl && this.tl.play(0);
    env.gsap.to(this.wave, { op: 0, duration: 0.7, ease: 'expo.inOut', overwrite: true });
  }

  setSize() {
    this.grid.bounding = this.grid.el.getBoundingClientRect();
    this.bounding = this.container.getBoundingClientRect();
    this.ctaMaxSize = Math.min(this.bounding.width, this.bounding.height) - 32;
    this.cta.style.setProperty('--size', `${this.ctaMaxSize}px`);
  }

  setGrid() {
    const g = this.grid, w = g.bounding.width, h = g.bounding.height;
    g.width = w; g.height = h;
    g.svg.style.width = `${w}px`; g.svg.style.height = `${h}px`;
    g.points = [];
    g.vLines = env.isDesktop ? 12 : 8;
    g.gapX = w / g.vLines;
    g.gapY = this.bounding.height / 8;
    g.hLines = Math.floor(h / g.gapY);
    const off = h - g.gapY * g.hLines;
    const center = { x: w / 2, y: h - this.bounding.height / 2 };
    for (let n = 0; n <= g.vLines; n++) {
      const col = [];
      for (let a = 0; a <= g.hLines; a++) {
        const p = { x: g.gapX * n, y: g.gapY * a + (a !== 0 ? off : 0), vx: 0, vy: 0, wx: 0, wy: 0, mx: 0, my: 0, ox: 0, oy: 0, dx: 0, dy: 0, dist: 0 };
        const hx = p.x - center.x, cy = p.y - center.y, ang = Math.atan2(cy, hx);
        p.dist = Math.hypot(hx, cy);
        if (p.dist !== 0) { p.dx = Math.cos(ang) * (w / 2 / p.dist) * 5; p.dy = Math.sin(ang) * (w / 2 / p.dist) * 5; }
        col.push(p);
      }
      g.points.push(col);
    }
    this.movePoints();
  }

  createPulseTimeline() {
    if (!env.gsap || env.reducedMotion) return;
    const text = qs('.js-button-text', this.container);
    this.tl = env.gsap.timeline({ repeat: -1, repeatDelay: 0.5, paused: true });
    this.tl.call(() => { this.wave.state = 'pulse'; });
    this.tl.fromTo(text, { scale: 0.85 }, { scale: 1.05, duration: 2.7, ease: 'power2.in' });
    this.tl.call(() => this.wavePulse());
    this.tl.to(text, { scale: 0.85, duration: 0.15, ease: 'power4.out' });
  }

  movePoints() {
    const { grid: g, wave: w } = this;
    const diag = Math.hypot(window.innerHeight, window.innerWidth);
    const easeOut = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
    g.points.forEach((col) => col.forEach((p, o) => {
      if (o === 0 || p.dist === 0) return;
      const a = Math.abs(p.dist - w.progress), l = 30;
      if (a < l) {
        const hh = 1 - a / l, c = Math.atan2(p.dy, p.dx), f = Math.cos(a * 0.01) * hh;
        p.vx += Math.cos(c) * f * l * 0.5 * w.strength;
        p.vy += Math.sin(c) * f * l * 0.5 * w.strength;
      }
      p.vx += (0 - p.wx) * 0.001; p.vy += (0 - p.wy) * 0.001;
      p.vx *= 0.9; p.vy *= 0.9;
      p.wx += p.vx * 3; p.wy += p.vy * 3;
      p.wx *= 0.9; p.wy *= 0.9;
      p.mx = p.wx * 0.1; p.my = p.wy * 0.1;
      p.ox = easeOut(p.dx / diag) * g.gapX * 75 * (p.dist / this.ctaMaxSize);
      p.oy = easeOut(p.dy / diag) * g.gapY * 75 * (p.dist / this.ctaMaxSize);
    }));
  }

  moved(p) { return { x: p.x + p.mx + p.ox * this.wave.op, y: p.y + p.my + p.oy * this.wave.op }; }

  drawLines() {
    const g = this.grid;
    let d = '';
    g.points.forEach((col) => col.forEach((p, r) => { const m = this.moved(p); d += `${r === 0 ? 'M' : 'L'} ${m.x.toFixed(1)} ${m.y.toFixed(1)} `; }));
    for (let i = 0; i < g.hLines; i++) g.points.forEach((col, r) => { const m = this.moved(col[i]); d += `${r === 0 ? 'M' : 'L'} ${m.x.toFixed(1)} ${m.y.toFixed(1)} `; });
    g.path.setAttribute('d', d);
  }

  wavePulse() {
    if (this.isActive) return;
    Object.assign(this.wave, { progress: 0, state: 'pulse', speed: env.isDesktop ? 15 : 10, strength: env.isDesktop ? 1 : 0.35 });
  }

  waveShock() {
    if (!this.isActive || this.wave.state === 'shock') return;
    Object.assign(this.wave, { progress: 0, state: 'shock', speed: 30, strength: 5 });
  }

  tick() {
    const w = this.wave;
    if (w.progress < this.grid.height && w.state !== 'paused') w.progress += w.speed;
    this.movePoints();
    this.drawLines();
  }
}
