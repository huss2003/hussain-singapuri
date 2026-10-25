// core/router.js — the server serves ONE shell (public/index.html) for every page route and injects
// <meta name="nw:route" content="home|book|pay|done|404">. The router picks the view from that meta
// (falling back to the pathname). Navigation inside the /book flow uses history.pushState; crossing
// between "/" and the booking pages is a normal page load (the home page owns heavy scroll scenes).
import { qs } from './env.js';

const ROUTES = [
  { name: 'home', re: /^\/$/ },
  { name: 'book', re: /^\/book\/?$/ },
  { name: 'pay', re: /^\/book\/pay\/([\w-]+)\/?$/ },
  { name: 'done', re: /^\/book\/done\/([\w-]+)\/?$/ },
];

export function matchRoute(pathname) {
  for (const r of ROUTES) { const m = pathname.match(r.re); if (m) return { name: r.name, id: m[1] || null }; }
  return { name: '404', id: null };
}

export class Router {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.root = qs('.js-view');
    document.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('popstate', () => this.render(location.pathname));
  }

  async start() {
    const meta = qs('meta[name="nw:route"]');
    const route = matchRoute(location.pathname);
    if (meta && meta.content === '404') route.name = '404';
    document.documentElement.dataset.route = route.name;
    await this.render(location.pathname, route);
  }

  isBookFlow(name) { return name === 'book' || name === 'pay' || name === 'done'; }

  onClick(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const current = matchRoute(location.pathname).name;
    const next = matchRoute(url.pathname).name;
    // In-page anchor on the home page → smooth scroll (Header handles .js-menu-link; this covers the rest)
    if (current === 'home' && url.pathname === '/' && url.hash) {
      if (this.app.scrollTo(url.hash)) { e.preventDefault(); history.replaceState(null, '', url.hash); }
      return;
    }
    if (this.isBookFlow(current) && this.isBookFlow(next)) {
      e.preventDefault();
      this.navigate(url.pathname + url.search);
    }
  }

  navigate(path, { replace = false } = {}) {
    history[replace ? 'replaceState' : 'pushState'](null, '', path);
    return this.render(new URL(path, location.href).pathname);
  }

  async render(pathname, route = matchRoute(pathname)) {
    if (this.view && this.view.destroy) this.view.destroy();
    document.documentElement.dataset.route = route.name;
    let mod;
    if (route.name === 'home') mod = await import('../views/home.js');
    else if (this.isBookFlow(route.name)) mod = await import('../views/book.js');
    else mod = await import('../views/notfound.js');
    this.view = await mod.mount(this.root, { app: this.app, route, router: this });
    this.app.observe(this.root);
    if (route.name !== 'home') window.scrollTo(0, 0);
    this.app.onResize(true);
  }
}
