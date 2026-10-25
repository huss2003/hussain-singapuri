// sections/Intro.js — the original App.intro() preloader (motion-notes §3), values unchanged:
//   t0    wrapper visible under the overlay, overlay background → transparent
//   0     5 vertical bars scaleY 0→1 (1s power4.inOut, stagger .15)
//   1     link bars scaleX 0→1 (.4s power4.inOut)       · frame borders grow in (3s power3.inOut)
//   2     vertical bars collapse from the top (1s power4.in, stagger .1) · 2.1 link bars collapse
//   2.15  document 'intro' event (timeline end − 1.85) → Header + Hero choreography overlaps the preloader
//   5     frame (.site-mount) on, overlay removed, scroll unlocked, 'updateViewport'
// Additions: any key / click skips; reduced motion, non-home routes and repeat visits (sessionStorage) are instant.
import { bus, ticker } from '../core/bus.js';
import { env, qs, qsa } from '../core/env.js';

export class Intro {
  constructor(app) {
    this.app = app;
    this.el = qs('.js-intro');
    this.done = false;
    window.__NW_INTRO_FIRED__ = false;
  }

  play() {
    const html = document.documentElement;
    const instant = !this.el || !env.gsap || env.reducedMotion || html.classList.contains('no-intro');
    if (instant) return this.finish(true);
    const gsap = env.gsap;
    const wrapper = qs('.js-site-wrapper');
    const vBars = qsa('.js-logo-line-v', this.el);
    const hBars = qsa('.js-logo-line-h', this.el);
    const top = qs('.js-border-top', this.el), left = qs('.js-border-left', this.el), right = qs('.js-border-right', this.el);

    const tl = gsap.timeline();
    this.tl = tl;
    tl.call(() => html.classList.remove('is-booting'), null, 0);   // = set(wrapper, { opacity: '' })
    tl.set(wrapper, { opacity: '' }, 0);
    tl.set(this.el, { background: 'transparent' }, 0);
    tl.fromTo(vBars, { scaleY: 0 }, { scaleY: 1, duration: 1, ease: 'power4.inOut', stagger: 0.15 }, 0);
    tl.fromTo(hBars, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'power4.inOut', stagger: 0 }, 1);
    tl.set(vBars, { transformOrigin: '50% 0' });
    tl.fromTo(vBars, { scaleY: 1 }, { scaleY: 0, duration: 1, ease: 'power4.in', immediateRender: false, stagger: 0.1 }, 2);
    tl.fromTo(hBars, { scaleY: 1 }, { scaleY: 0, duration: 0.5, ease: 'power4.in', immediateRender: false, stagger: 0.1 }, 2.1);
    tl.from(top, { scaleY: 0, duration: 3, ease: 'power3.inOut' }, 1);
    tl.from([left, right], { scaleX: 0, duration: 3, ease: 'power3.inOut' }, 1);
    tl.call(() => this.fireIntro(), null, '-=1.85');                // ≈ 2.15s
    tl.call(() => this.finish(false), null, 5);

    this.skip = (e) => {
      if (this.done || (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key))) return;
      tl.progress(1);   // runs every callback (intro event + finish) synchronously
    };
    window.addEventListener('keydown', this.skip);
    this.el.addEventListener('click', this.skip);
  }

  fireIntro(instant = false) {
    if (window.__NW_INTRO_FIRED__) return;
    window.__NW_INTRO_FIRED__ = true;
    document.dispatchEvent(new CustomEvent('intro', { detail: { instant } }));
  }

  finish(instant) {
    if (this.done) return;
    this.done = true;
    const html = document.documentElement;
    html.classList.remove('is-booting', 'is-scroll-blocked');
    html.classList.add('is-ready');
    if (instant) { html.classList.add('no-intro'); this.fireIntro(true); }
    if (this.el) this.el.remove();
    if (this.skip) { window.removeEventListener('keydown', this.skip); }
    try { if (!instant && location.pathname === '/') sessionStorage.setItem('hs-intro', '1'); } catch { /* ignore */ }
    if (this.app.lenis) this.app.lenis.start();
    ticker.nextTick(() => bus.emit('updateViewport'));
  }
}
