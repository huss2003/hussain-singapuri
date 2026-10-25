// sections/Scrollbar.js — mirrors the original `ic` custom scrollbar in the right frame band.
// thumb height = vh / scrollHeight × vh ; top = scrollProgress × (vh − thumb) ; drag → scrollTo.
import { bus } from '../core/bus.js';
import { qs, clamp } from '../core/env.js';

export class Scrollbar {
  constructor(app) {
    this.app = app;
    this.el = qs('.js-scrollbar');
    this.thumb = qs('.js-thumb');
    if (!this.el) return;
    this.drag = null;
    bus.on('resize', this.update, this);
    bus.on('scroll', this.update, this);
    bus.on('siteLoaded', this.update, this);
    bus.on('updateViewport', this.update, this);
    this.thumb.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    window.addEventListener('pointerup', () => this.onUp());
    this.update();
  }
  update() {
    const vh = window.innerHeight, sh = document.documentElement.scrollHeight;
    const h = Math.max(24, (vh / sh) * vh);
    const p = clamp(window.scrollY / Math.max(1, sh - vh), 0, 1);
    this.el.style.setProperty('--scrollbar-height', `${h}px`);
    this.el.style.setProperty('--scrollbar-top', `${p * (vh - h)}px`);
    this.el.style.display = sh <= vh + 2 ? 'none' : '';
  }
  onDown(e) {
    e.preventDefault();
    const sh = document.documentElement.scrollHeight, vh = window.innerHeight;
    this.drag = { y: e.clientY, start: window.scrollY / Math.max(1, sh - vh), max: sh - vh, track: Math.max(1, vh - this.thumb.offsetHeight) };
    this.el.classList.add('is-dragging');
  }
  onMove(e) {
    if (!this.drag) return;
    const { y, start, max, track } = this.drag;
    const target = clamp(start + (e.clientY - y) / track, 0, 1) * max;
    if (this.app.lenis) this.app.lenis.scrollTo(target, { immediate: true });
    else window.scrollTo(0, target);
  }
  onUp() { if (this.drag) { this.drag = null; this.el.classList.remove('is-dragging'); } }
}
