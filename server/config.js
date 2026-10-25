// server/config.js — every tunable, read from environment variables in one place.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const int = (v, fb) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? n : fb; };
const port = int(env.PORT, 3000);

export const config = {
  root: ROOT,
  env: env.NODE_ENV || 'development',
  port,
  host: env.HOST || undefined,
  // Empty = derive the origin from the request (works on every Vercel URL)
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  publicDir: path.resolve(env.PUBLIC_DIR || path.join(ROOT, 'public')),
  contentFile: path.join(ROOT, 'data', 'content.json'),
  shellFile: path.join(ROOT, 'server', 'shell.html'),
  ownerEmail: env.OWNER_EMAIL || 'owner@example.com',
  ipSalt: env.SESSION_SECRET || 'dev-only-salt',
  minFormMs: int(env.MIN_FORM_MS, 3000),          // humans need > 3 s to fill the form
  enquiryLimit: { max: int(env.RATE_LIMIT_MAX, 5), windowSec: 600 },
  bookingLimit: { max: 20, windowSec: 600 },
  bodyLimit: 16 * 1024,
  crmWebhookUrl: env.CRM_WEBHOOK_URL || '',
};
