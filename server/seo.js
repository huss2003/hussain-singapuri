// server/seo.js
// -----------------------------------------------------------------------------
// Server-side SEO for a single-shell site.
//
// The frontend is ONE file (public/index.html); its JS router picks the view
// from location.pathname. Crawlers and link-preview bots often don't run JS,
// so the server injects the right <title>, description, canonical, Open Graph,
// Twitter and JSON-LD tags per route before sending the shell — and answers
// unknown paths with a REAL 404 status (a "soft 404" with 200 hurts SEO).
// Also serves robots.txt, sitemap.xml and site.webmanifest.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { content, getService } from './content.js';
import { addNonce } from './security.js';
// (origin is derived per request so every Vercel alias gets correct absolute URLs)
import { send } from './http.js';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// JSON inside <script> must not contain "</script>"; escaping "<" handles it.
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

/** Route table: first match wins. Each returns the meta for that page. */
function routeMeta(pathname, base) {
  const { site, projects, services } = content();
  const person = {
    '@type': 'Person', '@id': `${base}/#person`, name: site.owner, jobTitle: site.role, url: `${base}/`, image: `${base}/images/og.jpg`,
    alumniOf: { '@type': 'CollegeOrUniversity', name: 'Vishwakarma Institute of Technology, Pune' },
    hasCredential: { '@type': 'EducationalOccupationalCredential', name: 'Claude Certified Developer — Foundations' },
    address: { '@type': 'PostalAddress', addressLocality: site.location, addressCountry: site.country },
    knowsAbout: ['AI agents', 'LLM inference', 'RAG', 'Multi-agent systems', 'Workflow automation', 'Full-stack web development', 'Creative web development'],
    sameAs: site.socials.map((x) => x.url),
  };
  if (pathname === '/') {
    return {
      route: 'home', status: 200, indexable: true,
      title: `${site.owner} — ${site.role} · AI agents, automations & websites`,
      description: `${site.owner} is an AI engineer in ${site.location}, India: 3 years building web apps and AI agents for a US medtech company, ${projects.length} shipped projects. ${site.tagline}`.slice(0, 300),
      jsonld: {
        '@context': 'https://schema.org',
        '@graph': [
          person,
          { '@type': 'ProfessionalService', '@id': `${base}/#service`, name: `${site.owner} — ${site.role}`, url: `${base}/`, image: `${base}/images/og.jpg`,
            founder: { '@id': `${base}/#person` }, areaServed: 'Worldwide', address: { '@type': 'PostalAddress', addressLocality: site.location, addressCountry: site.country } },
          { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: site.owner, inLanguage: 'en' },
          { '@type': 'ItemList', name: 'Selected work', itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.title, url: p.client_url, description: p.summary })) },
        ],
      },
    };
  }
  if (pathname === '/book') {
    return {
      route: 'book', status: 200, indexable: true,
      title: `Book a call — ${site.owner}`,
      description: 'Book a free 30-minute intro call, or a paid 60-minute AI strategy session, with AI engineer Hussain Singapuri. US-friendly hours.',
      jsonld: { '@context': 'https://schema.org', '@graph': services.map((svc) => ({
        '@type': 'Service', name: svc.name, serviceType: 'Consultation', provider: person, areaServed: 'Worldwide', url: `${base}/book`, description: svc.description,
        offers: { '@type': 'Offer', price: (svc.price / 100).toFixed(2), priceCurrency: svc.currency, url: `${base}/book` },
      })) },
    };
  }
  if (/^\/book\/pay\/[A-Za-z0-9_-]{1,64}$/.test(pathname)) return { route: 'pay', status: 200, indexable: false, title: `Payment — ${site.owner}`, description: 'Complete your booking.' };
  if (/^\/book\/done\/[A-Za-z0-9_-]{1,64}$/.test(pathname)) return { route: 'done', status: 200, indexable: false, title: `Booking — ${site.owner}`, description: 'Your call booking.' };
  return { route: '404', status: 404, indexable: false, title: `Page not found — ${site.owner}`, description: 'This page does not exist.' };
}

function headTags(meta, pathname, base) {
  const { site } = content();
  const url = `${base}${pathname}`;
  const image = `${base}/images/og.jpg`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta name="robots" content="${meta.indexable ? 'index, follow' : 'noindex, nofollow'}">`,
    `<meta name="nw:route" content="${meta.route}">`,
    `<meta name="theme-color" content="#0A0D00">`,
    `<link rel="manifest" href="/site.webmanifest">`,
    `<link rel="icon" href="/images/favicon.svg" type="image/svg+xml">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:locale" content="${esc(site.locale)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  if (meta.status === 200) {
    tags.push(`<link rel="canonical" href="${esc(url)}">`, `<meta property="og:url" content="${esc(url)}">`);
  }
  if (meta.jsonld) tags.push(`<script type="application/ld+json">${jsonLd(meta.jsonld)}</script>`);
  return tags.join('\n    ');
}

/** Remove tags we are about to own, so the frontend's defaults don't duplicate them. */
function stripManagedTags(html) {
  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+[^>]*(name|property)\s*=\s*["'](description|robots|theme-color|nw:route|og:[^"']+|twitter:[^"']+)["'][^>]*>\s*/gi, '')
    .replace(/<link\s+[^>]*rel\s*=\s*["'](canonical|manifest)["'][^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
}

let shellCache = { mtimeMs: -1, html: '' };
function loadShell() {
  const { mtimeMs } = fs.statSync(config.shellFile);
  if (mtimeMs !== shellCache.mtimeMs) shellCache = { mtimeMs, html: fs.readFileSync(config.shellFile, 'utf8') };
  return shellCache.html;
}

/** Build the HTML for a page route. Returns { status, html, meta }. */
export function renderPage(pathname, nonce, base) {
  const meta = routeMeta(pathname, base);
  let html = stripManagedTags(loadShell());
  const tags = headTags(meta, pathname, base);
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `    ${tags}\n  </head>`) : `${tags}\n${html}`;
  return { status: meta.status, html: addNonce(html, nonce), meta };
}

export function handlePage(req, res, pathname, nonce, base) {
  const { status, html, meta } = renderPage(pathname, nonce, base);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (!meta.indexable) headers['X-Robots-Tag'] = 'noindex';
  send(req, res, status, html, headers);
}

// ---- robots / sitemap / manifest --------------------------------------------

export function handleRobots(req, res, ctx) {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /book/pay/',
    'Disallow: /book/done/',
    '',
    `Sitemap: ${ctx.origin}/sitemap.xml`,
    '',
  ].join('\n');
  send(req, res, 200, body, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
}

export function handleSitemap(req, res, ctx) {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [['/', '1.0'], ['/book', '0.6']]
    .map(([p, prio]) => `  <url><loc>${ctx.origin}${p}</loc><lastmod>${lastmod}</lastmod><priority>${prio}</priority></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  send(req, res, 200, body, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
}

export function handleManifest(req, res) {
  const { site } = content();
  const body = JSON.stringify({
    name: `${site.owner} — ${site.role}`,
    short_name: site.short || 'HS',
    start_url: '/',
    display: 'standalone',
    background_color: '#C6FF00',
    theme_color: '#0A0D00',
    icons: [{ src: '/images/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }, null, 2);
  send(req, res, 200, body, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
}
