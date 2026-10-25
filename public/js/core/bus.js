// core/bus.js — mirrors the original's `_l` event bus ($) and `lh` tick manager (xe).
// Events: tick(timeMs) · resize(widthChanged, heightChanged) · scroll(scrollY) · mousemove(x, y)
//         siteLoaded · updateViewport · contrastchange(theme) · intro
class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, cb, ctx = null, once = false) {
    const list = this.map.get(evt) || [];
    if (!list.some((l) => l.cb === cb && l.ctx === ctx)) list.push({ cb, ctx, once });  // de-dupe by cb+ctx
    this.map.set(evt, list);
  }
  once(evt, cb, ctx = null) { this.on(evt, cb, ctx, true); }
  off(evt, cb, ctx = null) {
    const list = this.map.get(evt);
    if (list) this.map.set(evt, list.filter((l) => !(l.cb === cb && l.ctx === ctx)));
  }
  emit(evt, ...args) {
    const list = this.map.get(evt);
    if (!list || !list.length) return;
    for (const l of [...list]) {
      if (l.once) this.off(evt, l.cb, l.ctx);
      try { l.cb.apply(l.ctx, args); } catch (err) { console.error(`[bus:${evt}]`, err); }
    }
  }
}
export const bus = new EventBus();

// One RAF loop for the whole site: gsap.ticker when GSAP loaded, requestAnimationFrame otherwise.
class Ticker {
  constructor() { this.queue = []; this.delta = 16.7; this.last = 0; this.started = false; this.tick = this.tick.bind(this); }
  init() {
    if (this.started) return;
    this.started = true;
    if (window.gsap) window.gsap.ticker.add((t) => this.tick(t * 1000));
    else { const loop = (t) => { this.tick(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  }
  nextTick(cb, ctx = null) { this.queue.push([cb, ctx]); if (!this.started) Promise.resolve().then(() => this.flush()); }
  flush() { const q = this.queue; this.queue = []; for (const [cb, ctx] of q) { try { cb.call(ctx); } catch (e) { console.error('[nextTick]', e); } } }
  tick(time) {
    this.delta = this.last ? time - this.last : 16.7;
    this.last = time;
    this.flush();
    bus.emit('tick', time);
  }
}
export const ticker = new Ticker();
