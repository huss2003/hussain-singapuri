// elements/a-separator.js — mirrors the original `Cc` <a-separator>: a 2.25rem ruled strip of
// 7-bit "binary" groups separated by ///// fillers. Each char is a 2em "01" column translated to show
// 0 or 1; while visible every non-blank char has a 10% chance per frame to flip (binary flicker).
// Built from data-words="Nova|Wren|…": each group spells its word in 7-bit ASCII (chars separated by a
// blank cell), so the strip literally encodes a phrase — like the original's name / "Do Things Your Way".
// The whole element is decorative → aria-hidden (the original exposed the 0/1 noise to screen readers).
import { bus } from '../core/bus.js';
import { env } from '../core/env.js';

class ASeparator extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.setAttribute('aria-hidden', 'true');
    if (!this.querySelector('.a__code')) this.build((this.dataset.words || 'NW').split('|'));
    this.chars = Array.from(this.querySelectorAll('.js-char:not(.a__char--blank)'));
    this.addEventListener('intersect', (e) => {
      if (env.reducedMotion) return;
      if (e.detail.isIntersecting) bus.on('tick', this.tick, this);
      else bus.off('tick', this.tick, this);
    });
  }
  disconnectedCallback() { bus.off('tick', this.tick, this); }
  build(words) {
    const bits = (word) => Array.from(word).map((c) => c.charCodeAt(0).toString(2).padStart(7, '0'));
    let html = '<span class="a__triangle"></span><span class="a__binaries">';
    words.forEach((w) => {
      html += '<span class="a__code js-code">';
      html += bits(w).map((b) => Array.from(b).map((d) => `<span class="a__char a__char--${d} js-char">${d}</span>`).join('')).join('<span class="a__char a__char--blank js-char"> </span>');
      html += '</span><span class="a__stripes"></span>';
    });
    html += '</span><span class="a__triangle"></span>';
    this.innerHTML = html;
  }
  tick() {
    for (const c of this.chars) {
      if (Math.random() > 0.1) continue;
      c.classList.remove('a__char--0', 'a__char--1');
      c.classList.add(`a__char--${Math.random() > 0.5 ? '0' : '1'}`);
    }
  }
}
customElements.define('a-separator', ASeparator);
