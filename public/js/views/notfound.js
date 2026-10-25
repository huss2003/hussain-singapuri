// views/notfound.js — branded 404 (the original served Apache's default page with a version banner).
// The server already answers unknown routes with status 404 + noindex; this is the visible page.
import '../elements/a-separator.js';
import { esc } from '../core/env.js';

export function mount(root) {
  const path = location.pathname;
  const bin = Array.from('lost').map((c) => c.charCodeAt(0).toString(2).padStart(7, '0')).join(' ');
  document.title = 'Not found — NW';
  root.innerHTML = `
  <section class="page nf" aria-labelledby="nf-title">
    <div class="page__head">
      <p class="page__kicker">Error 404</p>
      <h1 class="u-sr-only" id="nf-title">Page not found</h1>
      <span class="nf__code" aria-hidden="true">404</span>
      <span class="nf__binary" aria-hidden="true">${bin}</span>
      <p class="page__lede">Nothing lives at <code>${esc(path)}</code>. It may have moved, or it never existed.</p>
    </div>
    <div class="page-card"><h2 class="page-card__title">Where to next</h2>
      <div class="page-card__body" style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:center">
        <a class="btn" href="/">Back to the homepage</a><a class="btn btn--ghost" href="/book">Book a call</a>
      </div>
    </div>
  </section>
  <a-separator data-intersect class="style--secondary" data-words="Lo|st|In|Sp|ace"></a-separator>`;
  return { destroy() {} };
}
