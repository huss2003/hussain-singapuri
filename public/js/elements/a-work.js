// elements/a-work.js — mirrors the original `Tc` <a-work> card. The Work timeline tweens its `progress`
// ATTRIBUTE from 1 → −1 (attr tween); attributeChangedCallback mirrors it to the CSS var --progress and
// toggles in/out of view exactly at ±1 (original: video.play()/pause() + .is-inview → content-visibility).
// Skeleton: a poster <img> (GET /media/pXX.svg from the API) replaces the MP4. While in view a lazily
// created canvas draws a cheap "playback" shimmer (moving scan band + flicker) at ~30fps; it stops when
// the card leaves. If the poster fails to load, a canvas-generated poster is used instead.
import { bus } from '../core/bus.js';
import { env } from '../core/env.js';

export function generatePoster(seedText, label, w = 1082, h = 636) {
  let a = 0; for (const c of seedText) a = (a * 31 + c.charCodeAt(0)) | 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#0A0D00'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#3A4A00'; x.lineWidth = 1;
  for (let i = 0; i < w; i += 48) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
  for (let i = 0; i < h; i += 48) { x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(w, i + 0.5); x.stroke(); }
  x.strokeStyle = '#C6FF00'; x.lineWidth = 3;
  const cx = w * (0.3 + rnd() * 0.4), cy = h * (0.3 + rnd() * 0.4);
  for (let i = 1; i < 7; i++) { x.beginPath(); x.arc(cx, cy, i * h * 0.06 * (1 + rnd() * 0.3), 0, Math.PI * 2); x.stroke(); }
  x.fillStyle = '#C6FF00'; x.font = '700 22px "JetBrains Mono", monospace';
  x.fillText(String(label || '').toUpperCase(), 32, h - 32);
  return c.toDataURL('image/png');
}

class AWork extends HTMLElement {
  static observedAttributes = ['progress'];
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.img = this.querySelector('.js-video');
    this.media = this.querySelector('.a__media');
    this.isPlaying = false;
    this.lastDraw = 0;
    if (this.img) {
      this.img.addEventListener('error', () => {
        if (this.img.dataset.fallback) return;
        this.img.dataset.fallback = '1';
        this.img.src = generatePoster(this.dataset.slug || 'x', this.dataset.label || '');
      }, { once: true });
    }
  }
  disconnectedCallback() { bus.off('tick', this.tick, this); }
  attributeChangedCallback(name, _old, value) {
    if (name !== 'progress') return;
    this.style.setProperty('--progress', value);
    const edge = value === '1' || value === '-1' || Math.abs(parseFloat(value)) >= 0.9999;
    if (edge) { if (this.isPlaying) this.outView(); }
    else if (!this.isPlaying) this.inView();
  }
  inView() {
    this.isPlaying = true;
    this.classList.add('is-inview');
    if (this.img && this.img.loading === 'lazy') this.img.loading = 'eager';
    if (!env.reducedMotion) bus.on('tick', this.tick, this);
  }
  outView() {
    this.isPlaying = false;
    this.classList.remove('is-inview');
    bus.off('tick', this.tick, this);
  }
  ensureCanvas() {
    if (this.canvas) return true;
    if (!this.media) return false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'a__shimmer';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.width = 270; this.canvas.height = 159;    // quarter-res; CSS scales it
    this.media.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.phase = Math.random();
    return true;
  }
  tick(t) {
    if (t - this.lastDraw < 33 || !this.ensureCanvas()) return;   // ~30fps is plenty for a shimmer
    this.lastDraw = t;
    const { ctx, canvas: { width: w, height: h } } = this;
    ctx.clearRect(0, 0, w, h);
    const p = ((t / 2200) + this.phase) % 1;
    const y = p * (h + 40) - 20;
    const g = ctx.createLinearGradient(0, y - 18, 0, y + 18);
    g.addColorStop(0, 'rgba(198,255,0,0)'); g.addColorStop(0.5, 'rgba(198,255,0,0.22)'); g.addColorStop(1, 'rgba(198,255,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 18, w, 36);
    ctx.fillStyle = 'rgba(198,255,0,0.08)';
    for (let i = 0; i < 3; i++) ctx.fillRect(0, Math.random() * h, w, 1);
  }
}
customElements.define('a-work', AWork);
