// app.js — mirrors the original's `tc` App class:
//   platform classes · debounced resize (200ms → nextTick) emitting resize(widthChanged, heightChanged)
//   · passive scroll → window.scrollProgress + 'scroll' · mousemove · ONE IntersectionObserver for every
//   [data-intersect] (dispatches DOM 'intersect' + toggles is-in-view / is-out-of-view[-top|-bottom])
//   · Lenis on the GSAP ticker with lagSmoothing(0) · then the router mounts a view and the Intro runs.
import { bus, ticker } from './core/bus.js';
import { env } from './core/env.js';
import { Router } from './core/router.js';
import { Intro } from './sections/Intro.js';
import { Header } from './sections/Header.js';
import { Scrollbar } from './sections/Scrollbar.js';
import { MobileMenu } from './sections/MobileMenu.js';

class App {
  constructor() {
    this.timeouts = { resize: null };
    this.windowWidth = undefined;
    this.windowHeight = undefined;
    this.lenis = null;
    const ua = navigator.userAgent;
    const os = /Win/.test(ua) ? 'windows' : /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'unknown';
    const br = /Firefox/.test(ua) ? 'firefox' : /Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'unknown';
    document.documentElement.classList.add(`is-${os}`, `is-${br}`);
    this.io = new IntersectionObserver((entries) => entries.forEach((e) => this.onIntersect(e)), { threshold: 0 });
  }

  async init() {
    window.__NW_APP__ = this;
    this.setupGsap();
    this.bindEvents();
    this.initLenis();
    ticker.init();
    this.onResize();
    this.observe(document);

    // Shared chrome
    this.header = new Header(this);
    this.scrollbar = new Scrollbar(this);
    this.menu = new MobileMenu(this);

    // Preloader starts immediately (covers the content fetch), the view mounts underneath.
    this.intro = new Intro(this);
    this.router = new Router(this);
    try { await this.router.start(); } catch (err) { console.error('[router]', err); }
    if (document.readyState === 'complete') this.siteLoaded();
    else window.addEventListener('load', () => this.siteLoaded(), { once: true });
    ticker.nextTick(() => this.intro.play());
  }

  setupGsap() {
    const { gsap } = window;
    if (!gsap) {
      document.documentElement.classList.add('no-gsap', 'is-work-static', 'no-intro');
      document.documentElement.classList.remove('is-scroll-blocked');
      return;
    }
    const plugins = [window.ScrollTrigger, window.SplitText, window.DrawSVGPlugin, window.SlowMo].filter(Boolean);
    gsap.registerPlugin(...plugins);
    // The work cards use EasePack's slow(0.15, 0.6). If EasePack failed to load, register the same maths.
    try { gsap.parseEase('slow(0.15,0.6)')(0.5); } catch { registerSlowEase(gsap); }
    if (!gsap.parseEase('slow')) registerSlowEase(gsap);
    if (!window.ScrollTrigger) document.documentElement.classList.add('is-work-static');
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      clearTimeout(this.timeouts.resize);
      this.timeouts.resize = setTimeout(() => ticker.nextTick(this.onResize, this), 200);
    });
    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    window.addEventListener('mousemove', (e) => bus.emit('mousemove', e.clientX, e.clientY), { passive: true });
    bus.on('updateViewport', () => { this.onResize(true); window.ScrollTrigger && window.ScrollTrigger.refresh(); });
    this.onScroll();
  }

  /** Observe every [data-intersect] inside root (views call this after rendering). */
  observe(root) {
    const list = root.matches && root.matches('[data-intersect]') ? [root] : [];
    root.querySelectorAll('[data-intersect]').forEach((el) => list.push(el));
    list.forEach((el) => this.io.observe(el));
  }

  onIntersect(e) {
    const el = e.target;
    el.dispatchEvent(new CustomEvent('intersect', { detail: { isIntersecting: e.isIntersecting } }));
    if (e.isIntersecting) {
      el.classList.add('is-in-view');
      el.classList.remove('is-out-of-view', 'is-out-of-view-top', 'is-out-of-view-bottom');
    } else {
      el.classList.remove('is-in-view');
      el.classList.add('is-out-of-view');
      el.classList.toggle('is-out-of-view-top', e.boundingClientRect.top < 0);
      el.classList.toggle('is-out-of-view-bottom', e.boundingClientRect.top > 0);
    }
  }

  initLenis() {
    if (!env.hasLenis || env.reducedMotion) return;   // reduced motion → native scrolling
    const lenis = new window.Lenis();                  // 1.1.13 defaults (lerp 0.1, smoothWheel, no syncTouch)
    if (window.ScrollTrigger) lenis.on('scroll', window.ScrollTrigger.update);
    if (window.gsap) {
      window.gsap.ticker.add((t) => lenis.raf(t * 1000));
      window.gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
    if (document.documentElement.classList.contains('is-scroll-blocked')) lenis.stop();
    window.lenis = lenis;
    this.lenis = lenis;
  }

  siteLoaded() {
    document.documentElement.classList.add('is-loaded');
    bus.emit('siteLoaded');
  }

  onResize(force = false) {
    const w = window.innerWidth, h = window.innerHeight;
    let wc = false, hc = false;
    if (this.windowWidth !== w) { if (this.windowWidth !== undefined) wc = true; this.windowWidth = w; }
    if (this.windowHeight !== h) { if (this.windowHeight !== undefined) hc = true; this.windowHeight = h; }
    window.safeWidth = w;
    window.safeHeight = h;
    window.maxScrollTop = Math.max(1, document.documentElement.scrollHeight - h);
    this.setScrollProgress();
    bus.emit('resize', wc || force === true, hc);
  }

  onScroll() {
    this.setScrollProgress();
    ticker.nextTick(() => bus.emit('scroll', window.scrollY));
  }

  setScrollProgress() { window.scrollProgress = window.scrollY / (window.maxScrollTop || 1); }

  /** Smooth anchor scroll used by the nav (easeInOutQuint, 1.5s like the original). */
  scrollTo(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;
    if (this.lenis) {
      this.lenis.scrollTo(el, { duration: 1.5, easing: (t) => (t < 0.5 ? 16 * t ** 5 : 1 + 16 * (t - 1) ** 5), ...opts });
    } else {
      el.scrollIntoView({ behavior: env.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
    return true;
  }
}

/** EasePack SlowMo maths (linearRatio, power, yoyoMode=false) registered as "slow". */
function registerSlowEase(gsap) {
  const make = (linearRatio = 0.7, power = 0.7) => {
    const p = Math.min(1, linearRatio);
    const pow = p < 1 ? power : 0, p1 = (1 - p) / 2, p3 = p1 + p;
    return (t) => {
      const r = t + (0.5 - t) * pow;
      if (t < p1) { const a = 1 - t / p1; return r - a * a * a * a * r; }
      if (t > p3) { const a = (t - p3) / p1; return r + (t - r) * a * a * a * a; }
      return r;
    };
  };
  const slow = make();
  slow.config = make;
  gsap.registerEase('slow', slow);
}

const app = new App();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.init(), { once: true });
else app.init();
export default app;
