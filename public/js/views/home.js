// views/home.js — renders the single long page from GET /api/content (or the built-in fallback),
// in the original's DOM order: hero → about/awards → separator → work → separator → my-way → CTA →
// (new) enquiry form. Then instantiates one class per section, like the original bundle did.
import '../elements/a-separator.js';
import '../elements/a-waves.js';
import '../elements/a-work.js';
import { getContent } from '../core/api.js';
import { esc, qs } from '../core/env.js';
import { Hero } from '../sections/Hero.js';
import { About } from '../sections/About.js';
import { Work } from '../sections/Work.js';
import { MyWay } from '../sections/MyWay.js';
import { Contact } from '../sections/Contact.js';
import { Enquiry, NEEDS, BUDGETS, TIMELINES } from '../sections/Enquiry.js';

const STAR = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M24 0C25.4 13.6 30.6 21.1 48 24 30.6 26.9 25.4 34.4 24 48 22.6 34.4 17.4 26.9 0 24 17.4 21.1 22.6 13.6 24 0Z"/></svg>';

function aboutCopy(site) {
  const v = (site.ventures || [])[0];
  const link = (x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}<span class="u-sr-only"> (opens in a new tab)</span></a>`;
  return `
    <p>I'm Hussain, a full stack web developer turned AI engineer. For three years I built web apps and AI agents for a US medtech company:
    React and Next.js front ends, Node and Python APIs, Postgres, auth and payments, plus five apps live on Google Play.</p>
    <p>Since then I've shipped ${esc(site.projects || 30)}+ projects: full-stack stores with Stripe and admin panels, motion-heavy sites,
    AI agents that answer leads and book jobs, RAG that cites its sources, and an LLM inference engine from scratch.
    I'm CTO of ${v ? link(v) : 'an AI education startup'}.</p>`;
}

function credentialsMarkup(items = []) {
  let html = '';
  items.filter((c) => c.kind === 'stat').slice(0, 3).forEach((c, i) => {
    html += `<li class="s__award s__award--counter s__award--a${i + 1} js-award">
      <span class="s__award__inner"><span class="s__award__name">${esc(c.big)}</span>
      <span class="s__award__counter">${esc(c.label)}</span></span>
      <span class="s__award__mask" aria-hidden="true"></span></li>`;
  });
  items.filter((c) => c.kind === 'text').slice(0, 7).forEach((c, i) => {
    html += `<li class="s__award s__award--text s__award--t${i + 1} js-award">
      <span class="s__award__inner"><span class="s__award__text">${esc(c.text)}</span></span>
      <span class="s__award__mask" aria-hidden="true"></span></li>`;
  });
  html += `<li class="s__award s__award--blank js-award" aria-hidden="true">
    <svg class="s__globe" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><ellipse cx="50" cy="50" rx="20" ry="48"/><ellipse cx="50" cy="50" rx="36" ry="48"/><line x1="50" y1="2" x2="50" y2="98"/><ellipse cx="50" cy="50" rx="48" ry="16"/><ellipse cx="50" cy="50" rx="48" ry="34"/><line x1="2" y1="50" x2="98" y2="50"/></svg>
    ${STAR.replace('<svg', '<svg class="s__spark"')}${STAR.replace('<svg', '<svg class="s__spark"')}${STAR.replace('<svg', '<svg class="s__spark"')}${STAR.replace('<svg', '<svg class="s__spark"')}
    <span class="s__award__mask"></span></li>`;
  return html;
}

function workMarkup(projects = []) {
  return projects.map((p, i) => {
    const label = `${p.client || p.title} — ${p.clip || ''}`.trim();
    const hasUrl = p.client_url && p.client_url !== '#';
    const open = hasUrl ? `<a class="a__link js-track" href="${esc(p.client_url)}" target="_blank" rel="noopener noreferrer" data-index="${i}" data-slug="${esc(p.slug)}">` : `<div class="a__link" data-index="${i}">`;
    const close = hasUrl ? '</a>' : '</div>';
    return `<a-work class="s__scene__work js-work" data-slug="${esc(p.slug)}" data-label="${esc(label)}" progress="1">
      ${open}
        <span class="a__media"><img class="a__video js-video" src="${esc(p.poster)}" alt="${esc(p.title)}${p.tags ? ` — ${esc(p.tags.join(', '))}` : ''}" width="1082" height="636" loading="lazy" decoding="async"></span>
        <span class="a__caption"><span class="a__caption__text">${esc(p.client || p.title)}${hasUrl ? ' <span class="a__open">↗ Open</span>' : ''}</span><span class="a__caption__key" aria-hidden="true">${esc(p.caption_key || '')}</span></span>
        <span class="a__summary">${esc(p.clip || '')}${p.tags?.length ? ` · ${esc(p.tags.join(' · '))}` : ''} — ${esc(p.summary || '')}${hasUrl ? `<span class="u-sr-only"> — opens ${p.kind === 'ai' && /github/.test(p.client_url) ? 'the repository' : 'the live site'} in a new tab</span>` : ''}</span>
      ${close}
    </a-work>`;
  }).join('');
}

const SERVICES = [
  ['Full-stack web apps', 'React / Next.js front ends, Node & Python APIs, Postgres, auth'],
  ['E-commerce & payments', 'Carts, stock, Stripe Checkout, webhooks, order emails'],
  ['Dashboards & admin', 'Internal tools, CRMs, analytics, role-based access'],
  ['AI agents & RAG', 'Tool-using agents, grounded chat with citations, evals'],
  ['Automations', 'Webhooks, CRM syncs, lead follow-up, n8n / Make / Zapier'],
  ['Motion websites', 'GSAP, Lenis, three.js, scroll stories that feel premium'],
];

function indexMarkup(projects = []) {
  const kindLabel = (p) => (/github\.com/.test(p.client_url) ? 'Repo' : 'Live site');
  return `
  <section class="s-index" id="projects" data-intersect aria-labelledby="index-title" tabindex="-1">
    <div class="s__head">
      <h2 class="s__title" id="index-title">What I build</h2>
      <ul class="s__services">${SERVICES.map(([t, d], i) => `<li><span class="s__num">${String(i + 1).padStart(2, '0')}</span><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('')}</ul>
    </div>
    <div class="s__bar">
      <h2 class="s__label" id="projects-title">Selected projects <span>(${projects.length})</span> · click to open</h2>
      <div class="s__filters" role="group" aria-label="Filter projects">
        <button type="button" class="js-filter" data-kind="all" aria-pressed="true">All</button>
        <button type="button" class="js-filter" data-kind="web" aria-pressed="false">Websites</button>
        <button type="button" class="js-filter" data-kind="ai" aria-pressed="false">AI systems</button>
      </div>
    </div>
    <ul class="s__list" aria-labelledby="projects-title">${projects.map((p, i) => `
      <li class="s__item" data-kind="${esc(p.kind || 'web')}">
        <a class="s__row js-track js-row" href="${esc(p.client_url)}" target="_blank" rel="noopener noreferrer" data-slug="${esc(p.slug)}" data-img="${esc(p.poster)}">
          <span class="s__n">${String(i + 1).padStart(2, '0')}</span>
          <span class="s__t">${esc(p.title)}</span>
          <span class="s__c">${esc(p.clip || '')}</span>
          <span class="s__g">${esc((p.tags || []).join(' · '))}</span>
          <span class="s__o">${kindLabel(p)} <span aria-hidden="true">↗</span><span class="u-sr-only"> (opens in a new tab)</span></span>
        </a>
      </li>`).join('')}</ul>
    <div class="s__preview js-preview" aria-hidden="true"><img alt="" width="1082" height="636"></div>
  </section>`;
}

function catcherLines(title = 'Shipping code since 2022') {
  const m = title.match(/^(.*?)\s+since\s+(\S+)$/i);
  if (!m) return [title];
  const words = m[1].split(/\s+/);
  return [words[0], words.slice(1).join(' ') || '', 'since', m[2]].filter(Boolean);
}

function myWayMarkup(timeline) {
  const items = (timeline && timeline.items) || [];
  const frames = items.map((t) => `
    <figure class="a-object a-object--frame">
      <span class="a__inner"><img class="a__img" src="${esc(t.image)}" alt="" width="${esc(t.width || 800)}" height="${esc(t.height || 800)}" loading="lazy" decoding="async" draggable="false">
      <figcaption class="a__caption">${esc(t.caption)}${t.year ? ` (${esc(t.year)})` : ''}</figcaption></span>
      <span class="a__side a__side--vertical"></span><span class="a__side a__side--horizontal"></span>
    </figure>`).join('');
  const stars = Array.from({ length: 10 }, () => `<div class="a-object a-object--star" aria-hidden="true"><div class="a__side a__side--top-left"></div><div class="a__side a__side--top-right"></div><div class="a__side a__side--bottom-left"></div><div class="a__side a__side--bottom-right"></div></div>`).join('');
  const lines = catcherLines(timeline && timeline.title).map(esc).join('<br>');
  return `
  <section class="s-my-way" data-intersect aria-labelledby="myway-title">
    <h2 class="u-sr-only" id="myway-title">${esc((timeline && timeline.title) || 'Timeline')}</h2>
    <ol class="u-sr-only">${items.map((t) => `<li>${t.year ? `${esc(t.year)}: ` : ''}${esc(t.caption)}</li>`).join('')}</ol>
    <svg class="s__smiley js-smiley" viewBox="0 0 90 90" aria-hidden="true" focusable="false">
      <circle class="s__smiley__face" cx="45" cy="45" r="43"/>
      <ellipse class="s__smiley__ink" cx="32" cy="36" rx="4.5" ry="7"/><ellipse class="s__smiley__ink" cx="58" cy="36" rx="4.5" ry="7"/>
      <path class="s__smiley__ink" d="M22 52c4 13 13 19 23 19s19-6 23-19l-4-1c-4 10-11 16-19 16s-15-6-19-16l-4 1Z"/>
    </svg>
    <div class="s__objects js-objects">${frames}${stars}<div class="s__ruler js-ruler"></div></div>
    <div class="s__catcher" aria-hidden="true">
      <div class="s__catcher__distorted-wrapper"><div class="s__catcher__distorted"><div class="s__catcher__text s__catcher__text--distorted">${lines}</div></div></div>
      <div class="s__catcher__normal-wrapper"><div class="s__catcher__normal"><div class="s__catcher__text s__catcher__text--normal">${lines}</div></div></div>
    </div>
    <svg class="s__svg js-svg" aria-hidden="true"><path class="s__svg__circular-path js-lines-circular-path"/></svg>
  </section>`;
}

function ctaMarkup() {
  const chars = (word) => Array.from(word).map((c) => {
    const inner = c === "'" ? '' : esc(c);
    const slice = c.endsWith("'") ? '' : inner;
    return `<span class="s__cta__char">${[0, 1, 2, 3].map(() => `<span class="s__cta__char__slice">${slice}</span>`).join('')}</span>`;
  }).join('');
  // "Let's": the apostrophe rides on the t as a superscript, like the original
  const lets = ['L', 'e', 't', 's'].map((c) => `<span class="s__cta__char">${[0, 1, 2, 3].map(() => `<span class="s__cta__char__slice">${c}${c === 't' ? '<span class="sup">\'</span>' : ''}</span>`).join('')}</span>`).join('');
  const star = '<svg class="s__cta__star" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 0C25.4 13.6 30.6 21.1 48 24 30.6 26.9 25.4 34.4 24 48 22.6 34.4 17.4 26.9 0 24 17.4 21.1 22.6 13.6 24 0Z"/></svg>';
  return `
  <section class="s-cta" data-intersect aria-labelledby="contact-title">
    <div id="contact" class="s__inner js-container" tabindex="-1">
      <h2 class="u-sr-only" id="contact-title">Contact — let's ship</h2>
      <div class="s__hover js-hover">
        <button class="s__button js-button" type="button" aria-expanded="false" aria-controls="cta-disc">
          <span class="s__button__inner"><span class="s__button__text js-button-text">Go</span></span>
          <span class="u-sr-only"> — reveal contact options</span>
        </button>
        <div class="s__cta js-cta" id="cta-disc">
          <div class="s__cta__line s__cta__line--top" aria-hidden="true"><div class="s__cta__text">${lets}</div></div>
          <div class="s__cta__line s__cta__line--bottom" aria-hidden="true"><div class="s__cta__text">${chars('Ship')}</div></div>
          <div class="s__cta__links js-cta-links">
            <a class="s__cta__link js-cta-link" href="#enquiry" tabindex="-1">Start a project</a>
            <a class="s__cta__link js-cta-link" href="/book" tabindex="-1">Book a free call</a>
          </div>
          <div class="s__cta__stars" aria-hidden="true">${star}${star}${star}${star}</div>
          <div class="a-dots" aria-hidden="true"></div>
        </div>
      </div>
    </div>
    <div class="s__grid js-grid" aria-hidden="true"><svg class="s__grid__svg js-grid-svg"><path class="s__grid__path js-grid-path"/></svg></div>
  </section>`;
}

const opts = (list) => list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
function enquiryMarkup() {
  return `
  <section class="s-enquiry" id="enquiry" aria-labelledby="enquiry-title" tabindex="-1">
    <div class="s__inner">
      <h2 class="s__title" id="enquiry-title">Start a project</h2>
      <p class="s__intro">AI agents, automations, websites or a full-stack build — tell me about it. I reply within two working days. Prefer to talk? <a class="u-link" href="/book">Book a free 30-minute call</a>.</p>
      <form class="form js-enquiry" novalidate>
        <div class="form__field"><label class="form__label" for="f-name">Name</label>
          <input class="form__input" id="f-name" name="name" autocomplete="name" required minlength="2" maxlength="100" aria-describedby="e-name">
          <p class="form__error" id="e-name" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="f-email">Email</label>
          <input class="form__input" id="f-email" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="e-email">
          <p class="form__error" id="e-email" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="f-company">Company <span class="form__opt">optional</span></label>
          <input class="form__input" id="f-company" name="company" autocomplete="organization" maxlength="100" aria-describedby="e-company">
          <p class="form__error" id="e-company" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="f-need">What do you need?</label>
          <select class="form__select" id="f-need" name="need" required aria-describedby="e-need"><option value="">Choose…</option>${opts(NEEDS)}</select>
          <p class="form__error" id="e-need" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="f-budget">Budget (USD)</label>
          <select class="form__select" id="f-budget" name="budget" required aria-describedby="e-budget"><option value="">Choose…</option>${opts(BUDGETS)}</select>
          <p class="form__error" id="e-budget" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="f-timeline">Timeline</label>
          <select class="form__select" id="f-timeline" name="timeline" required aria-describedby="e-timeline"><option value="">Choose…</option>${opts(TIMELINES)}</select>
          <p class="form__error" id="e-timeline" role="alert"></p></div>
        <div class="form__field form__field--full"><label class="form__label" for="f-message">Message <span class="form__opt">20+ characters</span></label>
          <textarea class="form__textarea" id="f-message" name="message" required minlength="20" maxlength="5000" aria-describedby="e-message" placeholder="What are you building, who is it for, and what does done look like?"></textarea>
          <p class="form__error" id="e-message" role="alert"></p></div>
        <div class="form__hp" aria-hidden="true"><label for="f-website">Website</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
        <input type="hidden" name="ts">
        <div class="form__foot"><p class="form__note">Your details are used only to reply to this enquiry.</p><button class="btn" type="submit">Send enquiry</button></div>
        <p class="form__status js-status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </section>`;
}

export async function mount(root, { app }) {
  const content = await getContent();
  const { site = {} } = content;
  const avail = qs('.js-availability');
  if (avail && site.location) avail.textContent = `Building globally from ${site.location}, India.`;

  root.innerHTML = `
  <div class="s-hero" data-intersect>
    <a-waves data-intersect class="s__waves"><svg class="js-svg"></svg></a-waves>
    <div class="s__content js-content">
      <a-separator data-intersect class="style--primary s__separator js-separator" data-words="Hus|sa|in |Sin|ga|pu|ri"></a-separator>
      <h1 class="s__title" aria-label="${esc(site.role || 'AI Engineer')}">
        <span class="s__title__word js-word" aria-hidden="true">${esc((site.role || 'AI Engineer').split(' ')[0])}</span>
        <img class="s__title__asset js-star" src="/images/star.svg" alt="" width="48" height="48">
        <span class="s__title__word js-word" aria-hidden="true">${esc((site.role || 'AI Engineer').split(' ').slice(1).join(' ') || 'Engineer')}</span>
      </h1>
      <a-separator data-intersect class="style--primary s__separator js-separator" data-words="Ag|ents|That|Ship"></a-separator>
    </div>
    <div class="s__border js-border"></div>
  </div>

  <section id="about" class="s-about" data-intersect tabindex="-1" aria-labelledby="about-title">
    <svg class="s__grid js-grid" aria-hidden="true"><path class="js-path"/></svg>
    <div class="s__inner js-inner">
      <div class="s__block s__block--about"><h2 class="s__title" id="about-title">About</h2><div class="s__content">${aboutCopy(site)}</div></div>
      <div class="s__block s__block--awards"><h2 class="s__title">Credentials</h2><ul class="s__awards">${credentialsMarkup(content.credentials)}</ul></div>
    </div>
    <canvas class="s__canvas js-canvas" aria-hidden="true"></canvas>
  </section>

  <a-separator data-intersect class="style--secondary" data-words="Build|Your|Own|Way"></a-separator>

  <section id="work" class="s-work" data-intersect tabindex="-1" aria-label="Work — ${esc(content.projects.length)} projects">
    <a class="s-work__skip" href="#after-work">Skip the work reel</a>
    <div class="s__outer">
      <div class="s__inner js-container">
        <h2 class="s__title" aria-label="Work"><span class="s__title__inner js-title" aria-hidden="true"><span class="s__title__letter js-letter">W</span><span class="s__title__letter js-letter">O</span><span class="s__title__letter js-letter">R</span><span class="s__title__letter js-letter">K</span></span></h2>
        <div class="s__scene js-scene">${workMarkup(content.projects)}</div>
        <canvas class="s__canvas js-canvas" aria-hidden="true"></canvas>
      </div>
      <div class="s__mask-outer" aria-hidden="true"><div class="s__mask js-mask"><svg class="s__mask__svg js-mask-svg"><path class="s__mask__path-outer js-mask-path-outer"/><path class="s__mask__path-inner js-mask-path-inner"/><path class="s__mask__path-lines js-mask-path-lines"/></svg></div></div>
      <div class="s__ruler js-ruler"></div>
    </div>
  </section>

  <a-separator data-intersect class="style--secondary" id="after-work" tabindex="-1" data-words="Ship|It|Fast"></a-separator>
  ${indexMarkup(content.projects)}
  ${myWayMarkup(content.timeline)}
  ${ctaMarkup()}
  ${enquiryMarkup()}`;

  app.observe(root);
  // project index: filters + a preview image that follows the pointer (fine pointers only)
  const idx = qs('.s-index', root);
  if (idx) {
    const btns = [...idx.querySelectorAll('.js-filter')];
    btns.forEach((b) => b.addEventListener('click', () => {
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      idx.querySelectorAll('.s__item').forEach((li) => { li.hidden = b.dataset.kind !== 'all' && li.dataset.kind !== b.dataset.kind; });
    }));
    const prev = qs('.js-preview', idx), img = prev.querySelector('img');
    if (matchMedia('(hover: hover) and (pointer: fine)').matches && !document.documentElement.classList.contains('is-reduced-motion')) {
      let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
      const loop = () => { x += (tx - x) * 0.18; y += (ty - y) * 0.18; prev.style.transform = `translate3d(${x}px, ${y}px, 0)`; raf = prev.classList.contains('is-on') ? requestAnimationFrame(loop) : 0; };
      idx.querySelectorAll('.js-row').forEach((row) => {
        row.addEventListener('pointerenter', () => { img.src = row.dataset.img; prev.classList.add('is-on'); if (!raf) raf = requestAnimationFrame(loop); });
        row.addEventListener('pointerleave', () => prev.classList.remove('is-on'));
      });
      idx.addEventListener('pointermove', (e) => { const r = idx.getBoundingClientRect(); tx = e.clientX - r.left + 24; ty = e.clientY - r.top - 120; });
    }
  }
  // outbound project clicks feed the "most-clicked projects" panel in /admin
  root.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.js-track');
    if (a && navigator.sendBeacon) navigator.sendBeacon(`/api/projects/${encodeURIComponent(a.dataset.slug)}/click`);
  });
  const sections = [];
  const start = () => {
    for (const [Cls, sel] of [[Hero, '.s-hero'], [About, '.s-about'], [Work, '.s-work'], [MyWay, '.s-my-way'], [Contact, '.s-cta'], [Enquiry, '.s-enquiry']]) {
      try { sections.push(new Cls(qs(sel, root), app)); } catch (err) { console.error(`[${Cls.name}]`, err); }
    }
  };
  // Measurements (letter widths, ruler, grids) need the web fonts; don't wait forever though.
  await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  start();
  if (location.hash) { const t = qs(location.hash); if (t) setTimeout(() => app.scrollTo(t, { immediate: true }), 0); }
  return { sections, destroy() { sections.forEach((s) => s.destroy && s.destroy()); } };
}
