// elements/a-waves.js — mirrors the original `Ec` <a-waves> custom element (motion-notes §5).
//   vertical polylines every 10px, points every 32px over (w+200)×(h+30)
//   wave: angle = perlin2((x + t·0.0125)·0.002, (y + t·0.005)·0.0015)·12 → offset (cos·32, sin·16)
//   cursor wake (after 'introend'): mouse lerp 0.1, speed vs lerp 0.1 capped 100, radius max(175, vs),
//   impulse cos(angle)·falloff·r·vs·0.00065, spring k 0.005, damping 0.925, clamp ±100px
// Changes: touchmove is PASSIVE (the original preventDefault()ed it, so swipes on the hero didn't scroll);
// reduced motion → drawn once, no loop.
import { bus } from '../core/bus.js';
import { env } from '../core/env.js';
import { Perlin } from './perlin.js';

const SVGNS = 'http://www.w3.org/2000/svg';

class AWaves extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.setAttribute('aria-hidden', 'true');
    this.svg = this.querySelector('svg') || this.appendChild(document.createElementNS(SVGNS, 'svg'));
    this.mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };
    this.lines = [];
    this.paths = [];
    this.noise = new Perlin(Math.random());
    this.isInteractive = false;
    this.isPaused = true;
    this.onResize = this.onResize.bind(this);
    requestAnimationFrame(() => { this.setSize(); this.setLines(); this.drawLines(); });
    bus.on('mousemove', this.updateMousePosition, this);
    bus.on('resize', this.onResize, this);
    this.addEventListener('touchmove', (e) => { const t = e.touches[0]; this.updateMousePosition(t.clientX, t.clientY); }, { passive: true });
    this.addEventListener('intersect', (e) => this.onIntersect(e));
    this.addEventListener('introend', () => { this.isInteractive = true; });
  }
  disconnectedCallback() {
    bus.off('mousemove', this.updateMousePosition, this);
    bus.off('resize', this.onResize, this);
    bus.off('tick', this.tick, this);
  }
  onResize() {
    // rebuild only when our box really changed (keeps DrawSVG intro tweens alive through 'updateViewport')
    if (this.bounding && this.clientWidth === this.bounding.width && this.clientHeight === this.bounding.height) {
      this.bounding.top = this.getBoundingClientRect().top + window.scrollY;
      return;
    }
    this.setSize(); this.setLines(); this.drawLines();
  }
  onIntersect(e) {
    this.isPaused = !e.detail.isIntersecting;
    if (env.reducedMotion) return;
    if (this.isPaused) bus.off('tick', this.tick, this);
    else bus.on('tick', this.tick, this);
  }
  updateMousePosition(x, y) {
    if (!this.bounding) return;
    const m = this.mouse;
    m.x = x - this.bounding.left;
    m.y = y - this.bounding.top + window.scrollY;
    if (!m.set) { m.sx = m.lx = m.x; m.sy = m.ly = m.y; m.set = true; }
  }
  setSize() {
    const r = this.getBoundingClientRect();
    this.svg.style.width = '';
    this.svg.style.height = '';
    this.bounding = { left: r.left, top: r.top + window.scrollY, width: this.clientWidth, height: this.clientHeight };
    this.svg.style.width = `${this.bounding.width}px`;
    this.svg.style.height = `${this.bounding.height}px`;
  }
  setLines() {
    const { width: w, height: h } = this.bounding;
    this.lines = [];
    this.paths.forEach((p) => p.remove());
    this.paths = [];
    const xGap = 10, yGap = 32;
    const oW = w + 200, oH = h + 30;
    const totalLines = Math.ceil(oW / xGap), totalPoints = Math.ceil(oH / yGap);
    const xStart = (w - xGap * totalLines) / 2, yStart = (h - yGap * totalPoints) / 2;
    for (let i = 0; i <= totalLines; i++) {
      const pts = [];
      for (let j = 0; j <= totalPoints; j++) {
        pts.push({ x: xStart + xGap * i, y: yStart + yGap * j, wave: { x: 0, y: 0 }, cursor: { x: 0, y: 0, vx: 0, vy: 0 } });
      }
      const path = document.createElementNS(SVGNS, 'path');
      path.classList.add('a__line', 'js-line');
      this.svg.appendChild(path);
      this.paths.push(path);
      this.lines.push(pts);
    }
    this.movePoints(performance.now());
  }
  movePoints(time) {
    const { lines, mouse, noise } = this;
    for (const pts of lines) {
      for (const p of pts) {
        const move = noise.perlin2((p.x + time * 0.0125) * 0.002, (p.y + time * 0.005) * 0.0015) * 12;
        p.wave.x = Math.cos(move) * 32;
        p.wave.y = Math.sin(move) * 16;
        if (!this.isInteractive) continue;
        const dx = p.x - mouse.sx, dy = p.y - mouse.sy;
        const d = Math.hypot(dx, dy), l = Math.max(175, mouse.vs);
        if (d < l) {
          const s = 1 - d / l, f = Math.cos(d * 0.001) * s;
          p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
          p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
        }
        p.cursor.vx += (0 - p.cursor.x) * 0.005;
        p.cursor.vy += (0 - p.cursor.y) * 0.005;
        p.cursor.vx *= 0.925;
        p.cursor.vy *= 0.925;
        p.cursor.x = Math.min(100, Math.max(-100, p.cursor.x + p.cursor.vx * 2));
        p.cursor.y = Math.min(100, Math.max(-100, p.cursor.y + p.cursor.vy * 2));
      }
    }
  }
  moved(p, withCursor = true) {
    return {
      x: Math.round((p.x + p.wave.x + (withCursor ? p.cursor.x : 0)) * 10) / 10,
      y: Math.round((p.y + p.wave.y + (withCursor ? p.cursor.y : 0)) * 10) / 10,
    };
  }
  drawLines() {
    this.lines.forEach((pts, i) => {
      const first = this.moved(pts[0], false);
      let d = `M ${first.x} ${first.y}`;
      pts.forEach((p, j) => { const m = this.moved(p, j !== pts.length - 1); d += `L ${m.x} ${m.y}`; });
      this.paths[i].setAttribute('d', d);
    });
  }
  tick(time) {
    const m = this.mouse;
    m.sx += (m.x - m.sx) * 0.1;
    m.sy += (m.y - m.sy) * 0.1;
    const dx = m.x - m.lx, dy = m.y - m.ly, d = Math.hypot(dx, dy);
    m.v = d;
    m.vs = Math.min(100, m.vs + (d - m.vs) * 0.1);
    m.lx = m.x; m.ly = m.y;
    m.a = Math.atan2(dy, dx);
    this.style.setProperty('--x', `${m.sx}px`);
    this.style.setProperty('--y', `${m.sy}px`);
    this.movePoints(time);
    this.drawLines();
  }
}
customElements.define('a-waves', AWaves);
