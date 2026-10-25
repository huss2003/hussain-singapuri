// sections/Hero.js — mirrors the original `_c` Hero class (motion-notes §3 "Hero intro", §5).
// SplitText(words → chars), each char wraps a .char__inner[data-letter] whose ::before/::after repeat
// the letter ×3 (row + column). Intro timeline on the 'intro' event (≈2.15s after DOM ready):
//   0    hero opacity 1 · border bar squashes to scaleY .025 and jumps up by the content height (1s expo.inOut)
//   0    <a-waves> rises from y 100% (1.35s expo.out)
//   0.45 char inners y −200% → −100% (2s expo.inOut, stagger .02)
//   0.5  wave lines DrawSVG "100% 100%" → "0% 100%" (3s expo.out, stagger {amount .5, from edges, power3.inOut})
//   0.75 separators slide in from alternating sides (1.5s expo.inOut)
//   1    content clip-path opens top→bottom while the bar sweeps back down (1s expo.inOut) — "curtain bar"
//   1.5  star rotates in from 90° (2s expo.out)
//   end−1 'introend' → cursor wake on; end → random slot flips (1% chance per tick, class to-{dir} for 2s)
import { bus } from '../core/bus.js';
import { env, qs, qsa } from '../core/env.js';

export class Hero {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.words = qsa('.js-word', el);
    this.isWaiting = true;
    this.chars = [];
    this.splitWords();
    bus.on('resize', this.onResize, this);
    el.addEventListener('intersect', (e) => {
      if (env.reducedMotion) return;
      if (e.detail.isIntersecting) bus.on('tick', this.tick, this);
      else bus.off('tick', this.tick, this);
    });
    if (window.__NW_INTRO_FIRED__) this.intro({ detail: { instant: true } });
    else document.addEventListener('intro', (e) => this.intro(e), { once: true });
  }

  onResize(widthChanged) { if (widthChanged) this.splitWords(); }

  splitWords() {
    if (this.st) this.st.revert();
    const wrap = (charEl) => {
      const letter = charEl.textContent;
      charEl.classList.add('char', `char--${letter.toLowerCase()}`);
      charEl.innerHTML = `<span class="char__inner" data-letter="${letter.toUpperCase()}">${letter}</span>`;
    };
    if (window.SplitText) {
      this.st = new window.SplitText(this.words, { type: 'words,chars', charsClass: 'char', wordsClass: 'word' });
      this.chars = this.st.chars;
    } else {   // no-CDN fallback: split by hand
      this.st = null;
      this.chars = [];
      this.words.forEach((w) => {
        const text = w.textContent.trim();
        w.innerHTML = Array.from(text).map((c) => `<span>${c}</span>`).join('');
        this.chars.push(...w.children);
      });
    }
    this.chars.forEach(wrap);
    // a11y fix over the original: screen readers get the real words once, not letter fragments
    const title = this.words[0]?.closest('h1');
    if (title) {
      title.setAttribute('aria-label', this.words.map((w) => w.textContent.trim()).join(' '));
      this.words.forEach((w) => w.setAttribute('aria-hidden', 'true'));
    }
    if (!this.isWaiting && window.gsap) window.gsap.set(qsa('.char__inner', this.el), { y: '-100%' });
  }

  intro(e) {
    const gsap = env.gsap;
    const instant = (e && e.detail && e.detail.instant) || !gsap || env.reducedMotion;
    const waves = qs('a-waves', this.el);
    const content = qs('.js-content', this.el);
    const border = qs('.js-border', this.el);
    const inners = qsa('.char__inner', content);
    const separators = qsa('.js-separator', content);
    const star = qs('.js-star', content);
    if (instant) {
      this.el.style.opacity = 1;
      if (gsap) gsap.set(inners, { y: '-100%' }); else inners.forEach((i) => { i.style.transform = 'translateY(-100%)'; });
      waves && waves.dispatchEvent(new CustomEvent('introend'));
      this.isWaiting = !!env.reducedMotion;   // no random flips under reduced motion
      return;
    }
    const lines = waves ? qsa('.js-line', waves) : [];
    const tl = gsap.timeline();
    if (lines.length && window.DrawSVGPlugin) {
      tl.fromTo(lines, { drawSVG: '100% 100%' }, { drawSVG: '0% 100%', duration: 3, ease: 'expo.out', stagger: { amount: 0.5, from: 'edges', ease: 'power3.inOut' } }, 0.5);
    }
    tl.call(() => waves && waves.dispatchEvent(new CustomEvent('introend')), null, '-=1')
      .set(this.el, { opacity: 1 }, 0)
      .to(border, { scaleY: 0.025, y: -content.clientHeight, duration: 1, ease: 'expo.inOut' }, 0)
      .from(waves, { y: '100%', duration: 1.35, ease: 'expo.out' }, 0)
      .fromTo(content, { clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)' }, { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', duration: 1, ease: 'expo.inOut' }, 1)
      .to(border, { scaleY: 1, y: 0, duration: 1, ease: 'expo.inOut' }, 1)
      .from(star, { rotate: 90, duration: 2, ease: 'expo.out' }, 1.5)
      .fromTo(inners, { y: '-200%' }, { y: '-100%', duration: 2, ease: 'expo.inOut', stagger: 0.02 }, 0.45)
      .from(separators, { y: (i) => (i % 2 === 0 ? '-100%' : '100%'), duration: 1.5, ease: 'expo.inOut' }, 0.75)
      .call(() => { this.isWaiting = false; });
  }

  animateChar() {
    if (this.isWaiting || Math.random() > 0.01 || !this.chars.length) return;
    const c = this.chars[Math.floor(Math.random() * this.chars.length)];
    if (['to-top', 'to-right', 'to-bottom', 'to-left'].some((k) => c.classList.contains(k))) return;
    const k = 'to-' + ['bottom', 'left', 'top', 'right'][Math.floor(Math.random() * 4)];
    c.classList.add(k);
    setTimeout(() => c.classList.remove(k), 2000);
  }

  tick() { this.animateChar(); }
}
