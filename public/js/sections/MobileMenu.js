// sections/MobileMenu.js — NEW (the original hid the nav ≤987px with no replacement).
// Toggle button in the header, full-screen ink panel, clip-path wipe (snap ease), Esc to close,
// focus moves in and returns to the toggle, background scroll paused, inert outside content.
import { qs, qsa } from '../core/env.js';

export class MobileMenu {
  constructor(app) {
    this.app = app;
    this.el = qs('.js-mobile-menu');
    this.toggle = qs('.js-menu-toggle');
    if (!this.el || !this.toggle) return;
    this.isOpen = false;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    this.toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    qs('.js-menu-close', this.el).addEventListener('click', () => this.close());
    qsa('a[data-link], a:not(.js-menu-link)', this.el).forEach((a) => a.addEventListener('click', () => this.close(false)));
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'Tab') this.trap(e);
    });
    window.addEventListener('resize', () => { if (this.isOpen && innerWidth > 987) this.close(false); });
  }
  open() {
    this.isOpen = true;
    this.el.inert = false;
    this.el.classList.add('is-open');
    this.el.removeAttribute('aria-hidden');
    this.toggle.setAttribute('aria-expanded', 'true');
    qs('.js-site-wrapper').inert = true;
    this.app.lenis ? this.app.lenis.stop() : (document.body.style.overflow = 'hidden');
    setTimeout(() => qs('.mobile-menu__list a', this.el).focus(), 50);
  }
  close(returnFocus = true) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('is-open');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    qs('.js-site-wrapper').inert = false;
    this.app.lenis ? this.app.lenis.start() : (document.body.style.overflow = '');
    if (returnFocus) this.toggle.focus();
  }
  trap(e) {
    const f = qsa('a, button', this.el);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
