// server/server.js
// -----------------------------------------------------------------------------
// One node:http handler, used by the local server and by the Vercel Function
// (api/index.js). Request order:
//   1. security headers + per-request CSP nonce on every response
//   2. /api/*      JSON API (enquiries, availability, bookings, Stripe webhook)
//   3. /admin*     studio admin (server-rendered, session login)
//   4. robots.txt, sitemap.xml, site.webmanifest
//   5. static files from public/ (on Vercel the CDN serves these first)
//   6. page routes → SEO-injected shell (200) or a real 404
// -----------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { HttpError, send, sendJson, sendError, readRawBody } from './http.js';
import { applySecurityHeaders } from './security.js';
import { q } from './db.js';
import { boot, refresh, content, etag } from './content.js';
import { handleEnquiry } from './leads.js';
import { handleAvailability, handleCreateBooking, handleGetBooking, handleRelease, handleTestConfirm, handleStripeWebhook } from './bookings.js';
import { handleAdmin } from './admin.js';
import { ensureAdmin } from './auth.js';
import { stripeEnabled } from './stripe.js';
import { handlePage, handleRobots, handleSitemap, handleManifest } from './seo.js';

// ---- routes ---------------------------------------------------------------------
const routes = [
  ['GET', '/api/health', async (req, res) => sendJson(req, res, 200, { ok: true, db: (await q('select 1 as ok'))[0]?.ok === 1, payments: stripeEnabled() ? 'stripe' : 'test-card' })],
  ['GET', '/api/content', (req, res) => {
    const { _note, ...data } = content();
    const tag = etag();
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
    sendJson(req, res, 200, data, { 'Cache-Control': 'no-cache', ETag: tag }); // revalidate: admin edits show at once
  }],
  ['POST', '/api/projects/:slug/click', async (req, res, ctx) => {
    await readRawBody(req, 1024).catch(() => '');
    await q('update projects set clicks = clicks + 1 where slug = $1', [ctx.params.slug]);
    res.writeHead(204); res.end();
  }, { csrf: false }],
  ['POST', '/api/enquiries', handleEnquiry],
  ['GET', '/api/availability', handleAvailability],
  ['POST', '/api/bookings', handleCreateBooking],
  ['GET', '/api/bookings/:id', handleGetBooking],
  ['POST', '/api/bookings/:id/release', handleRelease],
  ['POST', '/api/bookings/:id/confirm', handleTestConfirm],
  ['POST', '/api/webhooks/stripe', async (req, res, ctx) => handleStripeWebhook(req, res, ctx, await readRawBody(req, 512 * 1024)), { csrf: false }],
  ['GET', '/robots.txt', handleRobots],
  ['GET', '/sitemap.xml', handleSitemap],
  ['GET', '/site.webmanifest', handleManifest],
].map(([method, pattern, handler, opts = {}]) => {
  const keys = [];
  const source = pattern.replace(/[.]/g, '\\.').replace(/:([a-z]+)/gi, (_m, k) => { keys.push(k); return '([A-Za-z0-9_-]{1,100})'; });
  return { method, regex: new RegExp(`^${source}$`), keys, handler, csrf: opts.csrf !== false };
});

function matchRoute(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method === method || (r.method === 'GET' && method === 'HEAD')) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
  }
  return { pathMatched };
}

// ---- static files (local dev; on Vercel the CDN serves public/) -------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'BAD_PATH', 'Malformed URL encoding'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((s) => s.startsWith('.'))) return false;
  const file = path.resolve(config.publicDir, `.${decoded}`);
  if (!file.startsWith(config.publicDir + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': decoded.startsWith('/images/') ? 'public, max-age=86400' : 'public, max-age=600' };
  const tag = `W/"${Math.floor(st.mtimeMs / 1000).toString(16)}-${st.size.toString(16)}"`;
  headers.ETag = tag;
  if (req.headers['if-none-match'] === tag) { res.writeHead(304, headers); res.end(); return true; }
  send(req, res, 200, fs.readFileSync(file), headers);
  return true;
}

// ---- main handler -------------------------------------------------------------------
function originFor(req) {
  if (config.siteUrl) return config.siteUrl;
  const host = String(req.headers.host || '');
  const safe = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : `localhost:${config.port}`;
  const https = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
  return `${https ? 'https' : 'http'}://${safe}`;
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

async function handle(req, res) {
  const nonce = applySecurityHeaders(res);
  const started = Date.now();
  res.on('finish', () => { if (process.env.QUIET !== '1') console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`); });
  try {
    if (req.url.length > 2048) throw new HttpError(414, 'URI_TOO_LONG', 'URL too long');
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const origin = originFor(req);
    const ctx = { req, res, url, origin, nonce, secure: origin.startsWith('https://'), cookies: parseCookies(req), params: {} };

    if (pathname === '/admin' || pathname.startsWith('/admin/')) return await handleAdmin(ctx);

    const { route, params, pathMatched } = matchRoute(req.method, pathname);
    if (route) {
      ctx.params = params;
      if (route.method !== 'GET' && route.csrf) {
        const o = req.headers.origin;
        if (o && o !== origin) throw new HttpError(403, 'CROSS_ORIGIN', 'Cross-site request refused.');
      }
      await refresh();
      return await route.handler(req, res, ctx);
    }
    if (pathMatched) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} not allowed here`);
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'NOT_FOUND', 'Unknown API endpoint');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Only GET/HEAD for pages and files');
    if (pathname === '/index.html') { res.writeHead(301, { Location: '/' }); return res.end(); }
    if (path.extname(pathname)) {
      if (serveStatic(req, res, pathname)) return;
      throw new HttpError(404, 'NOT_FOUND', 'No such file');
    }
    if (pathname.length > 1 && pathname.endsWith('/')) { res.writeHead(308, { Location: pathname.replace(/\/+$/, '') + url.search }); return res.end(); }
    await refresh();
    return handlePage(req, res, pathname, nonce, origin);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) {
      if (err.status === 429 && err.extra.retry_after) res.setHeader('Retry-After', err.extra.retry_after);
      return sendError(req, res, err.status, err.code, err.message, err.extra);
    }
    console.error(err);
    return sendError(req, res, 500, 'INTERNAL', 'Something went wrong');
  }
}

export const handler = handle;

export async function start({ port = config.port, host = config.host } = {}) {
  await boot();
  await ensureAdmin();
  const server = http.createServer(handle);
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  await new Promise((r) => server.listen(port, host, r));
  console.log(`Hussain Singapuri portfolio on http://localhost:${server.address().port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await start();
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
