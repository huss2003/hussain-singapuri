// server/leads.js
// -----------------------------------------------------------------------------
// POST /api/enquiries — the lead pipeline.
//
//   request ─► rate limit ─► parse ─► bot checks ─► validate ─► leads table
//                                         │                         │
//                              202 (silently dropped)     owner email + auto-reply
//                                                         + lead.created event (CRM)
//                                                                   │
//                                                           201 { id, status }
//
// Bot checks run BEFORE validation and answer 202 without storing anything: a bot
// told "you failed the honeypot" adapts, a fake success teaches it nothing.
// -----------------------------------------------------------------------------
import { config } from './config.js';
import { readJson, sendJson, clientIp, HttpError } from './http.js';
import { q } from './db.js';
import { id, hashIp, rateLimit, emitEvent } from './util.js';
import * as mail from './email.js';

export const NEEDS = ['AI agent', 'Automation', 'Website', 'Full-stack app', 'Something else'];
export const BUDGETS = ['<$1k', '$1-5k', '$5-15k', '$15k+'];
export const TIMELINES = ['As soon as possible', 'Within a month', '1–3 months', 'Flexible'];
export const LEAD_STATUSES = ['new', 'contacted', 'proposal', 'won', 'lost'];

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Returns { value, errors } — errors maps field → human message. Mirrored in the browser (Enquiry.js). */
export function validateEnquiry(body) {
  const v = {
    name: str(body.name), email: str(body.email).toLowerCase(), company: str(body.company),
    need: str(body.need), budget: str(body.budget), timeline: str(body.timeline), message: str(body.message),
  };
  const errors = {};
  if (v.name.length < 2 || v.name.length > 100) errors.name = 'Name must be 2–100 characters';
  if (!EMAIL_RE.test(v.email) || v.email.length > 254) errors.email = 'Enter a valid email address';
  if (v.company.length > 100) errors.company = 'Company must be at most 100 characters';
  if (!NEEDS.includes(v.need)) errors.need = 'Choose what you need';
  if (!BUDGETS.includes(v.budget)) errors.budget = 'Choose a budget range';
  if (!TIMELINES.includes(v.timeline)) errors.timeline = 'Choose a timeline';
  if (v.message.length < 20 || v.message.length > 5000) errors.message = 'Message must be 20–5000 characters';
  return { value: v, errors };
}

function looksLikeBot(body) {
  if (str(body.website) !== '') return 'honeypot'; // hidden field humans never see
  const ts = Number(body.ts);
  if (!Number.isFinite(ts)) return 'no-timestamp';
  const elapsed = Date.now() - ts;
  if (elapsed < config.minFormMs) return 'too-fast';
  if (elapsed > 24 * 3600 * 1000) return 'stale-form';
  return null;
}

export async function handleEnquiry(req, res, ctx) {
  const ip = clientIp(req);
  await rateLimit(`enquiry:${ip}`, config.enquiryLimit);
  const { body } = await readJson(req);

  const bot = looksLikeBot(body);
  if (bot) {
    await emitEvent('enquiry.dropped', { reason: bot }, { source: 'system' });
    return sendJson(req, res, 202, { status: 'received' });
  }
  const { value, errors } = validateEnquiry(body);
  if (Object.keys(errors).length) throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields need attention', { fields: errors });

  const lead = { id: id('lead'), ...value };
  await q(`insert into leads (id, name, email, company, need, budget, timeline, message, ip_hash, user_agent, referer)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [lead.id, lead.name, lead.email, lead.company, lead.need, lead.budget, lead.timeline, lead.message,
    hashIp(ip), String(req.headers['user-agent'] || '').slice(0, 200), String(req.headers.referer || '').slice(0, 200)]);

  await Promise.all([mail.leadOwnerEmail(lead, ctx.origin), mail.leadAutoReply(lead, ctx.origin)]);
  await emitEvent('lead.created', { lead: { ...value, id: lead.id } }, { ref: lead.id });
  sendJson(req, res, 201, { id: lead.id, status: 'received' });
}
