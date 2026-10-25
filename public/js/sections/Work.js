// sections/Work.js — mirrors the original `vc` Work class: THE ONLY ScrollTrigger on the page.
// (motion-notes §4.2–4.4)
//  • fake pin: .s-work is N × 50lvh tall; .s__inner is position:fixed inside .s__outer whose clip-path
//    clips it to the section box → the scene is pinned without pin-spacers or reflow.
//  • keyhole: an evenodd SVG frame (full rect minus a pill matching .s__ruler) scales from 1 to
//    vw / (pillWidth/2) with power4.in → you fly "through" the WORK pill.
//  • one timeline { trigger: section, start 'top 25%', end 'bottom 75%', scrub: 1 } tweens plain numbers
//    (state, pointsProgress, animationProgress) and the `progress` ATTRIBUTE of each <a-work>.
//    state → CSS --state on the scene: every 3D transform is calc(… * var(--state)), so one number
//    morphs the stacked title into the barrel tunnel of letter ghosts.
//  • per tick: --scroll-progress (−1 entering, 0 inside, 1 leaving), letter marquee --progress per ghost,
//    dot canvas (24px grid, expands with pointsProgress, drifts with animationProgress).
// Timeline units: 0.75 intro + 0.25 per card (each card 0.5 long, slow(0.15,0.6)) + outro → 10.25 for 34.
import { bus } from '../core/bus.js';
import { env, qs, qsa, clamp } from '../core/env.js';

export class Work {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.container = qs('.js-container', el);
    this.ruler = qs('.js-ruler', el);
    this.scene = qs('.js-scene', el);
    this.canvas = qs('.js-canvas', this.container);
    this.ctx = this.canvas.getContext('2d');
    this.title = qs('.js-title', el);
    this.mask = {
      el: qs('.js-mask', el), svg: qs('.js-mask-svg', el),
      pathOuter: qs('.js-mask-path-outer', el), pathInner: qs('.js-mask-path-inner', el), pathLines: qs('.js-mask-path-lines', el),
      maxScale: 1,
    };
    this.letters = qsa('.js-letter', this.title).map((l) => ({ el: l, ghosts: [] }));
    this.works = qsa('.js-work', this.container).map((w) => ({ el: w }));
    this.points = [];
    this.state = 0; this.pointsProgress = 0; this.animationProgress = 0;
    this.scrollProgress = 0;
    this.last = { animationProgress: -1, pointsProgress: -1 };
    this.static = document.documentElement.classList.contains('is-work-static') || !env.hasScrollTrigger;
    if (this.static) { document.documentElement.classList.add('is-work-static'); return; }
    this.init();
  }

  init() {
    this.setCtxStyle();
    this.setSize();
    this.setMask();
    this.setPoints();
    this.setLetters();
    this.setWorks();
    this.setTimeline();
    bus.on('contrastchange', this.setCtxStyle, this);
    bus.on('resize', this.onResize, this);
    this.el.addEventListener('intersect', (e) => {
      if (e.detail.isIntersecting) bus.on('tick', this.tick, this);
      else bus.off('tick', this.tick, this);
    });
    // a11y: tabbing into a card scrolls the scrubbed scene to the moment that card is centred
    this.scene.addEventListener('focusin', (e) => {
      const link = e.target.closest('[data-index]');
      if (link) setTimeout(() => this.scrollToCard(Number(link.dataset.index)), 0);   // after the browser's own focus scroll
    });
  }

  onResize(widthChanged) {
    if (!widthChanged) return;
    this.setCtxStyle(); this.setSize(); this.setMask(); this.setPoints(); this.setLetters(); this.setWorks(); this.setTimeline();
  }

  setCtxStyle() {
    const color = getComputedStyle(this.el).getPropertyValue('--color-primary').trim();
    requestAnimationFrame(() => { this.ctx.strokeStyle = color; this.last.animationProgress = -1; });
  }

  setSize() {
    this.el.style.setProperty('--height', `${this.works.length * 50}lvh`);
    const w = window.innerWidth, h = window.innerHeight;
    this.bounding = { left: 0, top: 0, width: w, height: h };
    this.canvas.width = w;
    this.canvas.height = h;
    this.speed = Math.hypot(w, h) * 4;
  }

  setMask() {
    const m = this.mask;
    const e = m.el.clientWidth, i = m.el.clientHeight;
    m.width = e; m.height = i;
    m.svg.style.width = `${e}px`;
    m.svg.style.height = `${i}px`;
    const s = this.el.getBoundingClientRect(), r = this.ruler.getBoundingClientRect();
    const n = r.width, o = r.height, a = r.left - s.left, l = r.top - s.top;
    const rect = `M -1 0 L ${e + 2} 0 L ${e + 2} ${i} L -1 ${i} Z`;
    const pill = (c) => { const p = (c.tr.x - c.tl.x) / 2; return { p, d: `M ${c.tl.x} ${c.tl.y + p} A ${p} ${p} 0 0 1 ${c.tr.x} ${c.tr.y + p} L ${c.br.x} ${c.br.y - p} A ${p} ${p} 0 0 1 ${c.bl.x} ${c.bl.y - p} Z` }; };
    const c = { tl: { x: a, y: l }, tr: { x: a + n, y: l }, br: { x: a + n, y: l + o }, bl: { x: a, y: l + o } };
    const outer = pill(c);
    m.maxScale = window.innerWidth / outer.p;
    const outerD = `${rect} ${outer.d}`;
    m.pathOuter.setAttribute('d', outerD);
    const inset = env.isDesktop ? 16 : 8;
    c.tl.x += inset; c.tl.y += inset; c.tr.x -= inset; c.tr.y += inset; c.br.x -= inset; c.br.y -= inset; c.bl.x += inset; c.bl.y -= inset;
    m.pathInner.setAttribute('d', `${rect} ${pill(c).d}`);
    const cols = env.isDesktop ? 12 : 8, gx = e / cols, gy = i * 0.1, rows = Math.ceil(i / gy);
    let d = '';
    for (let b = 1; b < cols; b++) d += `M ${gx * b} 0 L ${gx * b} ${i} `;
    for (let b = 0; b < rows; b++) d += `M 0 ${gy * b} L ${e} ${gy * b} `;
    m.pathLines.setAttribute('d', d);
    m.pathLines.style.clipPath = `path(evenodd, '${outerD}')`;   // grid only on the volt frame, not in the hole
  }

  setLetters() {
    const vw = this.bounding.width;
    const cr = this.container.getBoundingClientRect();
    this.letters.forEach((L, s) => {
      L.ghosts.forEach((g) => g.el.remove());
      L.ghosts = [];
      const r = L.el.getBoundingClientRect();
      L.width = r.width; L.top = r.top - cr.top; L.left = r.left - cr.left;
      L.freq = 1 + Math.random();
      L.total = Math.round((vw / L.width) * (env.isDesktop ? 0.75 : 0.5)) + 2;
      for (let o = 0; o < L.total; o++) {
        const span = document.createElement('span');
        span.className = 's__scene__letter js-letter-ghost';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = L.el.textContent;
        span.dataset.letter = L.el.textContent;
        span.style.top = `${L.top}px`;
        span.style.left = `${L.left}px`;
        span.style.zIndex = '1'; // letters always sit behind the project cards
        span.style.setProperty('--iy', String(((s + 1) / (this.letters.length + 1) - 0.5) * 2));
        span.style.setProperty('--progress', '0.5');
        this.scene.appendChild(span);
        L.ghosts.push({ el: span });
      }
    });
    this.moveLetters();
  }

  setWorks() {
    this.works.forEach((w, i) => {
      w.el.style.setProperty('--size', String(0.5 + Math.random() * 0.5));
      w.el.style.setProperty('--y', String((0.5 + Math.random() * 0.5) * (i % 2 ? -1 : 1)));
    });
  }

  setTimeline() {
    const gsap = env.gsap;
    const { el, container, scene, mask } = this;
    const cards = this.works.map((w) => w.el);
    if (this.tl) { this.tl.scrollTrigger && this.tl.scrollTrigger.kill(); this.tl.kill(); }
    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 25%', end: 'bottom 75%', scrub: 1 },
      onUpdate: () => scene.style.setProperty('--state', String(this.state)),
    });
    tl.fromTo(mask.el, { scale: 1 }, { scale: mask.maxScale, duration: 0.75, ease: 'power4.in' }, 0)
      .fromTo(scene, { scale: 0.75 }, { scale: 1, duration: 0.75, ease: 'power3.in' }, 0)
      .fromTo(container, { clipPath: 'inset(0 1rem)' }, { clipPath: 'inset(0 0rem)', duration: 0.75, ease: 'power3.in' }, 0)
      .fromTo(this, { pointsProgress: 0 }, { pointsProgress: 1, duration: 1, ease: 'power4.inOut' }, 0)
      .fromTo(this, { state: 0 }, { state: 1, duration: 0.75, ease: 'power4.in' }, 0)
      .fromTo(cards, { attr: { progress: 1 } }, { attr: { progress: -1 }, ease: 'slow(0.15, 0.6)', stagger: 0.25 }, 0.75)   // default duration 0.5
      .fromTo(this, { animationProgress: 0 }, { animationProgress: 10000, duration: tl.totalDuration(), ease: 'power1.out' }, 0.75)
      .fromTo(this, { state: 1 }, { state: 0, duration: 0.75, ease: 'power4.inOut', immediateRender: false }, '-=1')
      .fromTo(mask.el, { scale: mask.maxScale }, { scale: 1, duration: 0.75, ease: 'power4.inOut', immediateRender: false }, '-=1')
      .fromTo(scene, { scale: 1 }, { scale: 0.75, duration: 0.75, ease: 'power3.inOut', immediateRender: false }, '-=1')
      .fromTo(container, { clipPath: 'inset(0 0rem)' }, { clipPath: 'inset(0 1rem)', duration: 0.75, ease: 'power3.inOut', immediateRender: false }, '-=1')
      .fromTo(this, { pointsProgress: 1 }, { pointsProgress: 0, duration: 1, ease: 'power4.inOut' }, '-=1');
    this.tl = tl;
  }

  scrollToCard(i) {
    const st = this.tl && this.tl.scrollTrigger;
    if (!st) return;
    const t = 0.75 + i * 0.25 + 0.25;              // card i is centred halfway through its 0.5 tween
    const y = st.start + (t / this.tl.totalDuration()) * (st.end - st.start);
    if (Math.abs(window.scrollY - y) < 4) return;
    if (this.app.lenis) this.app.lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
  }

  moveLetters() {
    const { speed, letters, animationProgress: ap } = this;
    letters.forEach((L) => {
      const n = speed * L.freq;
      L.ghosts.forEach((g, a) => g.el.style.setProperty('--progress', String((((ap % n) / n + a / L.total) % 1) / 0.7 - 0.15)));
    });
  }

  setPoints() {
    const { width: w, height: h } = this.bounding, gap = 24;
    const cols = Math.ceil((w * 1.2) / gap), rows = Math.ceil((h * 1.2) / gap);
    const ox = (w - cols * gap) * 0.5, oy = (h - rows * gap) * 0.5;
    this.points = [];
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const px = x * gap + ox, py = y * gap + oy;
      this.points.push({ x: px, y: py, dx: w * 0.5 - px, dy: h * 0.5 - py });
    }
  }

  drawPoints() {
    const { ctx, points, bounding: b } = this;
    const ap = Math.round(this.animationProgress * 100) / 100, pp = Math.round(this.pointsProgress * 100) / 100;
    if (ap === this.last.animationProgress && pp === this.last.pointsProgress) return;   // redraw only on change
    const flowX = (this.animationProgress * -0.05) % 24;
    ctx.clearRect(0, 0, b.width, b.height);
    ctx.beginPath();
    for (const p of points) ctx.rect(p.x + p.dx * (1 - this.pointsProgress) * 0.2 + flowX, p.y + p.dy * (1 - this.pointsProgress) * 0.2, 0.5, 0.5);
    ctx.stroke();
    this.last.animationProgress = ap;
    this.last.pointsProgress = pp;
  }

  tick() {
    const r = this.el.getBoundingClientRect(), vh = window.innerHeight;
    // = −clamp(positionInViewport(top)) + (1 − clamp(positionInViewport(bottom)))
    this.scrollProgress = -clamp(r.top / vh, 0, 1) + (1 - clamp(r.bottom / vh, 0, 1));
    this.el.style.setProperty('--scroll-progress', String(this.scrollProgress));
    this.moveLetters();
    this.drawPoints();
  }
}
