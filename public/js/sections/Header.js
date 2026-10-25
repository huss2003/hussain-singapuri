// sections/Header.js — mirrors the original `ec` Head class:
//   intro (on the 'intro' event): head y −100% → 0 (1.5s expo.inOut @1), logo + nav items stagger in
//   (1.5s expo.out, .1 @1.5), pattern "prints" via --bg-p 0→100% (1.5s expo.out @1.75), console starts @1.5.
//   console: types one char per tick when t − last ≥ delay (20ms; 100ms after "," or space; 400ms after
//   "." or "…", which also breaks the line), 2000ms pause between messages, last 5 lines kept.
//   contrast: volt mask sweeps (x 0 ↔ −100%, 1s expo.inOut), theme class flips, 'contrastchange'.
//   Added: theme persisted in localStorage, aria-pressed, keyboard-visible states.
import { bus } from '../core/bus.js';
import { env, qs, qsa, storage } from '../core/env.js';

// Own loading jokes, AI-engineer edition.
const MESSAGES = ['Warming up the attention heads', 'Re-ranking my priorities with BM25', 'Paging the KV cache… page 404 not found', 'Asking the agent to stop asking the agent', 'Tokenising my morning chai', 'Grounding every claim in a citation', 'Shipping on Friday… with tests this time', 'Retrying with exponential backoff', 'Prompt-injecting myself with coffee', 'Batching requests continuously', 'Speculatively decoding the next sentence', 'Evaluating the evals', 'Rate limiting my own ideas', 'Pen-testing the login form… again', 'Signing the webhooks, twice', 'Turning a website into an agent', 'Counting tokens, not sheep', 'Scrolling the timeline at 60fps', 'Writing the README before the code', 'Calibrating the volt levels', 'Removing one more div', 'Fine-tuning the easing curves', 'Booking a call with my own calendar', 'Converting chai into cubic-beziers', 'Checking the numbers against the source', 'Waking the multi-agent crew', 'Vector-searching for my keys', 'Caching the prefix, skipping the small talk', 'Reading robots.txt before I crawl', 'Deploying from Pune to everywhere', 'Pinging the US time zone', 'Hydrating the scroll scene', 'Aligning things nobody will notice', 'Loading… the loader', 'Teaching the grid to bend'];

export class Header {
  constructor(app) {
    this.app = app;
    this.el = qs('.site-head');
    this.console = qs('.js-console');
    this.contrastButton = qs('.js-contrast');
    this.contrastMask = qs('.js-contrast-mask');
    this.links = qsa('.js-menu-link');
    this.message = '';
    this.messageLineBreak = false;
    this.lastMessage = '';
    this.lastTypeTime = 0;
    this.writeDelay = 0;
    this.canWrite = false;
    this.text = '';
    this.caret = document.createElement('span');
    this.caret.className = 'sb-console__caret';
    this.syncContrastButton();
    this.bindEvents();
    if (window.__NW_INTRO_FIRED__) this.intro({ detail: { instant: true } });
  }

  bindEvents() {
    this.contrastButton.addEventListener('click', () => this.toggleContrast());
    this.links.forEach((a) => a.addEventListener('click', (e) => this.moveToSection(e)));
    document.addEventListener('intro', (e) => this.intro(e), { once: true });
    this.el.addEventListener('intersect', (e) => {
      if (e.detail.isIntersecting) bus.on('tick', this.updateConsole, this);
      else bus.off('tick', this.updateConsole, this);
    });
  }

  intro(e) {
    const gsap = env.gsap;
    const instant = (e && e.detail && e.detail.instant) || !gsap || env.reducedMotion;
    const qr = qs('.js-qr-code');
    if (instant) {
      this.el.style.opacity = 1;
      if (qr) qr.style.setProperty('--bg-p', '100%');
      if (env.reducedMotion) this.staticConsole();
      else this.canWrite = true;
      return;
    }
    const items = [qs('.js-logo', this.el), ...qsa('.js-menu-item', this.el)];
    const tl = gsap.timeline();
    tl.set(this.el, { opacity: 1 })
      .from(this.el, { y: '-100%', duration: 1.5, ease: 'expo.inOut' }, 1)
      .from(items, { y: '-100%', duration: 1.5, ease: 'expo.out', stagger: 0.1 }, 1.5)
      .fromTo(qr, { '--bg-p': '0%' }, { '--bg-p': '100%', duration: 1.5, ease: 'expo.out' }, 1.75)
      .call(() => { this.canWrite = true; }, null, 1.5);
  }

  staticConsole() {
    this.text = MESSAGES.slice(0, 4).join('\n');
    this.render();
  }

  render() {
    this.console.textContent = this.text;
    this.console.appendChild(this.caret);
  }

  updateConsole(t) {
    if (!this.canWrite || t - this.lastTypeTime < this.writeDelay) return;
    if (this.message === '') {
      this.message = this.getRandomMessage();
      this.writeDelay = 2000;
    } else {
      if (this.message === this.lastMessage || this.messageLineBreak) this.text += '\n';
      const c = this.message.charAt(0);
      this.message = this.message.substring(1);
      this.writeDelay = c === ',' || c === ' ' ? 100 : c === '…' || c === '.' ? 400 : 20;
      this.text += c;
      this.messageLineBreak = c === '…';
    }
    this.text = this.text.split('\n').slice(-5).join('\n');
    this.render();
    this.lastTypeTime = t;
  }

  getRandomMessage() {
    let m = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    if (m === this.lastMessage) m = this.getRandomMessage();
    this.lastMessage = m;
    return m;
  }

  syncContrastButton() {
    const on = document.documentElement.classList.contains('theme-contrasted');
    this.contrastButton.setAttribute('aria-pressed', String(on));
  }

  toggleContrast() {
    const html = document.documentElement;
    const toContrasted = !html.classList.contains('theme-contrasted');
    const done = () => {
      this.contrastMask.style.transform = '';
      html.classList.toggle('theme-contrasted', toContrasted);
      storage.set('hs-theme', toContrasted ? 'contrasted' : 'default');
      this.syncContrastButton();
      bus.emit('contrastchange', toContrasted ? 'contrasted' : 'default');
    };
    const gsap = env.gsap;
    if (!gsap || env.reducedMotion) return done();
    const [from, to] = toContrasted ? ['0%', '-100%'] : ['-100%', '0%'];
    gsap.fromTo(this.contrastMask, { x: from }, { x: to, duration: 1, ease: 'expo.inOut', onComplete: done });
    if (toContrasted) html.classList.add('theme-contrasted');   // swap under the mask immediately
  }

  moveToSection(e) {
    const a = e.currentTarget;
    const url = new URL(a.href, location.href);
    if (location.pathname !== '/' || !url.hash) return;           // other pages: normal navigation to /#hash
    e.preventDefault();
    this.app.menu && this.app.menu.close(false);
    if (this.app.scrollTo(url.hash)) {
      history.replaceState(null, '', url.hash);
      const target = qs(url.hash);
      if (target) setTimeout(() => target.focus({ preventScroll: true }), env.reducedMotion ? 0 : 1500);
    }
  }
}
