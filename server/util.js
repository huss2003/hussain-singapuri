// server/util.js — shared helpers: ids, a database-backed rate limiter, and the event/CRM emitter.
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { config } from './config.js';
import { HttpError } from './http.js';

export const id = (prefix, bytes = 9) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
export const hashIp = (ip) => crypto.createHmac('sha256', config.ipSalt).update(String(ip)).digest('hex').slice(0, 16);

/**
 * Fixed-window rate limit stored in Postgres, so every serverless instance shares one counter.
 * Throws 429 with retry_after when the key is over budget.
 */
export async function rateLimit(key, { max, windowSec }) {
  const r = await one(`insert into rate_limits (key, hits, window_start) values ($1, 1, now())
    on conflict (key) do update set
      hits = case when rate_limits.window_start > now() - make_interval(secs => $2) then rate_limits.hits + 1 else 1 end,
      window_start = case when rate_limits.window_start > now() - make_interval(secs => $2) then rate_limits.window_start else now() end
    returning hits, extract(epoch from (window_start + make_interval(secs => $2) - now()))::int as left_s`, [hashIp(key), windowSec]);
  if (r.hits > max) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, please try again later.', { retry_after: Math.max(1, r.left_s) });
}

/** Log an event; when CRM_WEBHOOK_URL is set also POST it there, HMAC-signed (lead.created, booking.confirmed …). */
export async function emitEvent(type, data, { source = 'crm', ref = null } = {}) {
  await q('insert into events (source, type, ref, data) values ($1,$2,$3,$4::jsonb)', [source, type, ref, JSON.stringify(data)]);
  if (!config.crmWebhookUrl || source !== 'crm') return;
  const body = JSON.stringify({ id: id('evt'), type, created: Math.floor(Date.now() / 1000), data });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', config.ipSalt).update(`${t}.${body}`).digest('hex');
  try {
    await fetch(config.crmWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hs-signature': `t=${t},v1=${sig}` }, body, signal: AbortSignal.timeout(4000) });
  } catch (e) { console.error('[crm webhook]', e.message); }
}
