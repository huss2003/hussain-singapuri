// core/env.js — feature detection shared by every section.
const boot = window.__NW__ || {};
const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export const env = {
  api: boot.api || '/api',
  reducedMotion: !!(mq.matches || /[?&]reduced=1/.test(location.search)),
  get gsap() { return window.gsap || null; },
  get hasScrollTrigger() { return !!(window.gsap && window.ScrollTrigger); },
  get hasLenis() { return typeof window.Lenis === 'function'; },
  get isDesktop() { return (window.safeWidth || innerWidth) > 767; },
  get isPhone() { return matchMedia('(max-width: 767px) and (orientation: landscape), (max-width: 576px)').matches; },
};
// Reload on preference change so every module re-reads it once (simple + predictable).
if (mq.addEventListener) mq.addEventListener('change', () => location.reload());

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const storage = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* private mode / blocked */ } },
};
