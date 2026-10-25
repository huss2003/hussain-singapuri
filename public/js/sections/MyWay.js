// sections/MyWay.js — mirrors the original `xc` (section) + `wc` (thrown object) classes.
//  • sunburst: SVG lines from 12 (8 ≤767) points on the top & bottom edges and from both sides to the
//    spinning smiley's centre.
//  • floor text: --distortion = hypot(w, (h − smileyY)/2) · 0.14 feeds perspective + matrix3d(…, D, …)
//    so the giant "since" text recedes to the smiley; --scroll-progress (lerp 0.1) slides it.
//  • thrown objects (16 captioned timeline frames + 10 extruded stars): spawn at z −20000, rx 90,
//    vz 40–50 px/f, vx/vy ±(vw|vh)·0.0025, spin .25–1.25°/f, scale +.005/f; ≤5 in flight; recycled at z>1000;
//    throw every (500–1000ms)·1.25 (×2 ≤767); 2–5 pre-placed mid-flight on load.
//  • drag: spring to the pointer (k .075, damping .9), tilt with velocity (ry = vx·.15, rx = −vy·.15);
//    release → gravity .5 + sprite-mask "vanish" (steps(29), .75s, .105s delay) and recycle after 1s.
// Changes: pointer events (mouse + touch + pen in one path); stars are draggable too; reduced motion →
// static captioned gallery, no loop.
import { bus } from '../core/bus.js';
import { env, qs, qsa } from '../core/env.js';

class ThrownObject {
  constructor(el, parent) {
    this.el = el;
    this.parent = parent;
    this.index = Array.from(el.parentNode.children).indexOf(el);
    this.isWaiting = true;
    el.classList.add('is-waiting');
  }
  set(thrown = true) {
    const vw = window.innerWidth, vh = window.innerHeight;
    this.el.style.setProperty('--size', String(0.5 + Math.random() * 0.5));
    Object.assign(this, {
      s: 0, x: 0, y: 0, z: -20000, rx: 90, ry: Math.random() * 2 - 1, rz: 0,
      vz: 40 + Math.random() * 10,
      vx: Math.random() * vw * 0.0025 * (this.index % 2 ? -1 : 1),
      vy: Math.random() * vh * 0.0025 * (this.index % 3 ? -1 : 1),
      vrx: 0.25 + Math.random(), vry: 0.25 + Math.random(),
      isWaiting: false, isDragging: false, isVanishing: false, vanishStart: 0, vanishDelay: 1000,
    });
    this.el.classList.remove('is-waiting', 'is-dragging', 'is-vanishing');
    if (!thrown) {   // pre-placed mid-flight
      Object.assign(this, { isWaiting: true, s: 1, x: this.vx * Math.random() * 200, y: this.vy * Math.random() * 200, rx: Math.random() * 360, ry: Math.random() * 360, z: Math.random() * -20000 });
    }
    this.el.style.setProperty('--s', String(this.s));
    this.apply();
  }
  move(t) {
    if (this.isWaiting) return;
    const P = this.parent;
    if (this.isDragging) {
      const tx = P.mouse.x - P.smiley.rel.x, ty = P.mouse.y - P.smiley.rel.y * 1.5;
      this.vx += (tx - this.x) * 0.075;
      this.vy += (ty - this.y) * 0.075;
      this.vz += (0 - this.z) * 0.3;
      this.ry = this.vx * 0.15; this.rx = this.vy * -0.15; this.rz = this.ry + this.rx;
      this.vx *= 0.9; this.vy *= 0.9; this.vz *= 0.75;
      this.x += this.vx * 0.5; this.y += this.vy * 0.5; this.z = Math.min(this.z + this.vz * 0.25, 500);
      this.s += (1 - this.s) * 0.5;
    } else if (this.isVanishing) {
      this.vy += 0.5; this.x += this.vx; this.y += this.vy; this.rx += this.vrx; this.ry += this.vry;
      if (t - this.vanishStart > this.vanishDelay) this.recycle();
    } else if (this.z > 1000) {
      this.recycle();
    } else {
      this.s = Math.min(this.s + 0.005, 1);
      this.z += this.vz; this.x += this.vx; this.y += this.vy; this.rx += this.vrx; this.ry += this.vry;
    }
    this.apply();
  }
  recycle() {
    this.isWaiting = true;
    this.el.classList.add('is-waiting');
    this.parent.objectMoveEnd(this);
  }
  apply() {
    const st = this.el.style;
    st.setProperty('--x', `${this.x}px`); st.setProperty('--y', `${this.y}px`); st.setProperty('--z', `${this.z}px`);
    st.setProperty('--rx', String(this.rx)); st.setProperty('--ry', String(this.ry)); st.setProperty('--rz', String(this.rz)); st.setProperty('--s', String(this.s));
  }
}

export class MyWay {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.svg = qs('.js-svg', el);
    this.wrapper = qs('.js-objects', el);
    this.ruler = qs('.js-ruler', el);
    this.circularPath = qs('.js-lines-circular-path', el);
    this.smiley = { el: qs('.js-smiley', el), rel: { x: 0, y: 0 } };
    this.mouse = { x: 0, y: 0, oy: 0, sx: 0, sy: 0, set: false };
    this.objects = qsa('.a-object', this.wrapper).map((o) => new ThrownObject(o, this));
    this.thrown = [];
    this.lastThrow = 0;
    this.throwDelay = 2000;
    this.isPaused = true;
    this.canThrow = false;
    this.dragged = null;
    this.timeline = qsa('.a-object--frame img', el);
    this.timeline.forEach((img, i) => img.addEventListener('error', () => this.fallbackImage(img, i), { once: true }));
    this.setSize();
    this.setScroll();
    this.setLines();
    if (env.reducedMotion) { this.objects.forEach((o) => o.el.classList.remove('is-waiting')); this.el.style.setProperty('--scroll-progress', '0.6'); return; }
    this.bindEvents();
    this.firstObjects();
  }

  fallbackImage(img, i) {   // generated stand-in if /media/tXX.svg isn't available
    const c = document.createElement('canvas'); c.width = 640; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#3A4A00'; x.fillRect(0, 0, 640, 800);
    x.strokeStyle = '#C6FF00'; x.lineWidth = 2;
    for (let k = 0; k < 14; k++) { x.beginPath(); x.arc(320, 400, 20 + k * 22 + (i * 7) % 20, 0, Math.PI * (1 + ((k + i) % 3) / 2)); x.stroke(); }
    img.src = c.toDataURL('image/png');
  }

  bindEvents() {
    bus.on('mousemove', this.updateMousePosition, this);
    bus.on('resize', this.onResize, this);
    bus.on('updateViewport', () => { this.setSize(); this.setScroll(); this.setLines(); });
    bus.on('scroll', this.onScroll, this);
    bus.on('tick', this.tick, this);
    this.objects.forEach((o) => o.el.addEventListener('pointerdown', (e) => this.dragStart(e, o)));
    window.addEventListener('pointermove', (e) => { if (this.dragged) this.updateMousePosition(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener('pointerup', () => this.dragEnd());
    window.addEventListener('pointercancel', () => this.dragEnd());
    this.el.addEventListener('intersect', (e) => {
      this.isPaused = !e.detail.isIntersecting;
      this.canThrow = e.detail.isIntersecting;
      if (!this.isPaused) this.thrown.forEach((o) => { o.isWaiting = false; o.el.classList.remove('is-waiting'); });
    });
  }

  updateMousePosition(x, y) {
    const m = this.mouse;
    m.x = x - this.bounding.left;
    m.y = y - m.oy + window.scrollY;
    if (!m.set) { m.sx = m.x; m.sy = m.y; m.set = true; }
  }

  onResize(widthChanged) { if (widthChanged) { this.setSize(); this.setScroll(); this.setLines(); } }

  onScroll(y) {
    const s = this.scroll, b = y + window.innerHeight;
    s.p = b < s.start ? 0 : b > s.end ? 1 : (b - s.start) / (s.end - s.start);
  }

  setSize() {
    const r = this.el.getBoundingClientRect();
    this.bounding = { left: r.left, top: r.top, width: r.width, height: r.height };
    this.svg.style.width = `${r.width}px`;
    this.svg.style.height = `${r.height}px`;
    const sr = this.smiley.el.getBoundingClientRect();
    this.smiley.rel.x = sr.left - r.left + sr.width / 2;
    this.smiley.rel.y = sr.top - r.top + sr.height / 2;
    this.mouse.oy = r.top + window.scrollY;
    if (!env.reducedMotion) this.wrapper.style.perspectiveOrigin = `50% ${this.ruler.clientHeight}px`;
  }

  setScroll() {
    const top = this.el.getBoundingClientRect().top + window.scrollY;
    this.scroll = { start: top, end: top + this.bounding.height + window.innerHeight, p: 0, sp: 0 };
    this.onScroll(window.scrollY);
    this.scroll.sp = this.scroll.p;
  }

  setLines() {
    const { smiley: sm, bounding: b } = this;
    const lines = [];
    const n = env.isDesktop ? 12 : 8, gx = b.width / n;
    for (let c = 0; c <= n; c++) {
      lines.push([{ x: gx * c, y: 0 }, sm.rel]);
      lines.push([{ x: gx * c, y: b.height }, sm.rel]);
    }
    this.el.style.setProperty('--distortion', String(Math.hypot(b.width, (b.height - sm.rel.y) / 2) * 0.14));
    const gy = b.height / n, oy = (b.height - gy * n) / 2;
    for (let c = 1; c < n; c++) {
      lines.push([{ x: 0, y: oy + gy * c }, sm.rel]);
      lines.push([{ x: b.width, y: oy + gy * c }, sm.rel]);
    }
    let d = `M 0 ${b.height} L ${b.width} ${b.height}`;
    lines.forEach(([p, q]) => { d += `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${q.x.toFixed(1)} ${q.y.toFixed(1)} `; });
    this.circularPath.setAttribute('d', d);
  }

  throwObject() {
    if (this.thrown.length < 5 && this.objects.length > 0) {
      const o = this.objects.splice(Math.floor(Math.random() * this.objects.length), 1)[0];
      o.set();
      this.thrown.push(o);
    }
    this.lastThrow = performance.now();
    this.throwDelay = (500 + Math.random() * 500) * (env.isDesktop ? 1.25 : 2);
  }

  firstObjects() {
    const n = Math.max(Math.min(Math.round(window.innerWidth * 0.025), 5), 2);
    for (let i = 0; i < n; i++) {
      const o = this.objects.splice(Math.floor(Math.random() * this.objects.length), 1)[0];
      o.set(false);
      this.thrown.push(o);
    }
  }

  objectMoveEnd(o) {
    this.thrown.splice(this.thrown.indexOf(o), 1);
    this.objects.push(o);
  }

  dragStart(e, o) {
    if (!this.thrown.includes(o) || o.isDragging || o.isVanishing) return;
    e.preventDefault();
    this.updateMousePosition(e.clientX, e.clientY);
    this.dragged = o;
    o.isDragging = true;
    o.el.classList.add('is-dragging');
  }

  dragEnd() {
    const o = this.dragged;
    if (!o) return;
    this.dragged = null;
    o.isDragging = false;
    o.el.classList.remove('is-dragging');
    o.isVanishing = true;
    o.el.classList.add('is-vanishing');
    o.vanishStart = performance.now();
  }

  tick(t) {
    const { scroll: s, mouse: m } = this;
    m.sx += (m.x - m.sx) * 0.1;
    m.sy += (m.y - m.sy) * 0.1;
    s.sp += (s.p - s.sp) * 0.1;
    this.el.style.setProperty('--scroll-progress', String(s.sp));
    const now = performance.now();
    this.thrown.slice().forEach((o) => o.move(now));
    if (!this.isPaused && this.canThrow && now - this.lastThrow > this.throwDelay) this.throwObject();
  }
}
