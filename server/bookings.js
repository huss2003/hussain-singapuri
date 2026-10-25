// server/bookings.js
// -----------------------------------------------------------------------------
// Calls: a free 30-minute intro call and a paid 60-minute AI strategy session.
//
//   GET  /api/availability?service=&month=   free slots (Asia/Kolkata wall clock, US-friendly evenings)
//   POST /api/bookings                       intro → confirmed at once
//                                            strategy → HELD for 31 min + Stripe Checkout Session
//   GET  /api/bookings/:id[?session_id=]     status (the Stripe return page confirms here)
//   POST /api/bookings/:id/release           Stripe cancel_url: free the slot straight away
//   POST /api/bookings/:id/confirm           built-in test card, only without STRIPE_SECRET_KEY
//
// State machine:  held ──paid──► confirmed        intro: ─────► confirmed
//                   └──timeout / cancel──► expired / cancelled
//
// Double booking is impossible at the database level: a partial unique index on
// slot_start covers every held or confirmed row, so the second insert fails (409).
// -----------------------------------------------------------------------------
import { config } from './config.js';
import { readJson, sendJson, clientIp, HttpError } from './http.js';
import { q, one, tx } from './db.js';
import { content, getService } from './content.js';
import { id, rateLimit, emitEvent } from './util.js';
import * as stripe from './stripe.js';
import * as mail from './email.js';

export const HOLD_MINUTES = 31; // Stripe Checkout sessions live at least 30 minutes

// ---- time-zone maths (no libraries) -------------------------------------------
function zoneOffset(ts, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}
export function zonedToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - zoneOffset(guess, timeZone);
  const second = guess - zoneOffset(utc, timeZone);
  if (second !== utc) utc = second;
  return new Date(utc);
}
const pad = (n) => String(n).padStart(2, '0');

/** Every slot in the window (tomorrow → N weeks), free or not. The slot id IS its UTC start. */
export function generateSlots(service) {
  const rules = content().booking;
  const tz = rules.timezone;
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()).split('-').map(Number);
  const out = [];
  for (let off = 1; off <= rules.weeks * 7; off++) {
    const day = new Date(Date.UTC(y, m - 1, d + off));
    if (!rules.weekdays.includes(day.getUTCDay())) continue;
    const [Y, M, D] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    for (const t of rules.times) {
      const [hh, mm] = t.split(':').map(Number);
      const start = zonedToUtc(Y, M, D, hh, mm, tz);
      out.push({ id: start.toISOString(), start: start.toISOString(), end: new Date(start.getTime() + service.duration_min * 60000).toISOString(), local: `${Y}-${pad(M)}-${pad(D)}T${t}`, timezone: tz });
    }
  }
  return out;
}

/** Free holds whose time ran out (lazy: runs on every booking read/write). */
export async function sweepHolds() {
  const r = await q("update bookings set status = 'expired' where status = 'held' and hold_expires_at < now() - interval '1 minute' returning id");
  for (const b of r) await emitEvent('booking.expired', { id: b.id }, { source: 'system', ref: b.id });
  return r.length;
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
export function publicBooking(b) {
  return {
    id: b.id, status: b.status, service: { id: b.service_id, name: b.service_name },
    slot: { start: iso(b.slot_start), end: iso(b.slot_end), local: b.slot_local, timezone: b.timezone },
    amount: b.amount, currency: b.currency, expires_at: b.status === 'held' ? iso(b.hold_expires_at) : null,
    pay_url: b.status === 'held' ? b.stripe_url || (stripe.stripeEnabled() ? null : `/book/pay/${b.id}`) : null,
    created_at: iso(b.created_at), confirmed_at: iso(b.confirmed_at) || null,
  };
}

// ---- handlers -------------------------------------------------------------------
export async function handleAvailability(req, res, ctx) {
  const month = ctx.url.searchParams.get('month');
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like YYYY-MM');
  const service = getService(ctx.url.searchParams.get('service') || 'intro');
  if (!service) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown service');
  await sweepHolds();
  const taken = new Set((await q("select slot_start from bookings where status in ('held','confirmed') and slot_start > now()")).map((r) => iso(r.slot_start)));
  const now = Date.now();
  const slots = generateSlots(service).filter((s) => !taken.has(s.id) && Date.parse(s.start) > now + 3600e3 && (!month || s.local.startsWith(month)));
  sendJson(req, res, 200, { timezone: content().booking.timezone, service, services: content().services, slots });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const s = (v) => (typeof v === 'string' ? v.trim() : '');

export async function handleCreateBooking(req, res, ctx) {
  await rateLimit(`booking:${clientIp(req)}`, config.bookingLimit);
  const { body } = await readJson(req);
  const service = getService(s(body.service) || 'intro');
  const v = { name: s(body.name), email: s(body.email).toLowerCase(), company: s(body.company), notes: s(body.notes) };
  const errors = {};
  if (!service) errors.service = 'Pick a call type';
  if (v.name.length < 2 || v.name.length > 100) errors.name = 'Name must be 2–100 characters';
  if (!EMAIL_RE.test(v.email) || v.email.length > 254) errors.email = 'Enter a valid email address';
  if (v.company.length > 100) errors.company = 'Company must be at most 100 characters';
  if (v.notes.length > 1000) errors.notes = 'Notes must be at most 1000 characters';
  const slot = service && generateSlots(service).find((x) => x.id === body.slot || x.local === body.slot);
  if (service && (!slot || Date.parse(slot.start) <= Date.now() + 3600e3)) errors.slot = 'Pick a slot from the calendar';
  if (Object.keys(errors).length) throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields need attention', { fields: errors });

  await sweepHolds();
  const paid = service.price > 0;
  const bookingId = id('bk');
  let b;
  try {
    b = await one(`insert into bookings (id, service_id, service_name, slot_start, slot_end, slot_local, timezone, name, email, company, notes, status, amount, currency, hold_expires_at, confirmed_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, case when $12 = 'held' then now() + make_interval(mins => $15) end, case when $12 = 'confirmed' then now() end) returning *`,
    [bookingId, service.id, service.name, slot.start, slot.end, slot.local, slot.timezone, v.name, v.email, v.company, v.notes,
      paid ? 'held' : 'confirmed', service.price, service.currency, HOLD_MINUTES]);
  } catch (e) {
    if (e.code === '23505' || /one_active_booking_per_slot|duplicate key/.test(e.message)) throw new HttpError(409, 'SLOT_TAKEN', 'That slot was just taken — pick another.');
    throw e;
  }

  if (!paid) {
    await finalize(b, ctx.origin, 'free');
    return sendJson(req, res, 201, { booking_id: b.id, status: 'confirmed', next: `/book/done/${b.id}` });
  }
  await emitEvent('booking.held', { id: b.id, slot: slot.local, service: service.id }, { source: 'system', ref: b.id });
  if (!stripe.stripeEnabled()) {
    return sendJson(req, res, 201, { booking_id: b.id, status: 'held', provider: 'test', pay_url: `/book/pay/${b.id}`, expires_at: iso(b.hold_expires_at) });
  }
  try {
    const cs = await stripe.createBookingCheckout(b, ctx.origin);
    await q('update bookings set stripe_session_id = $2, stripe_url = $3 where id = $1', [b.id, cs.id, cs.url]);
    sendJson(req, res, 201, { booking_id: b.id, status: 'held', provider: 'stripe', pay_url: cs.url, expires_at: iso(b.hold_expires_at) });
  } catch (e) {
    await q("update bookings set status = 'cancelled' where id = $1 and status = 'held'", [b.id]);
    throw new HttpError(502, 'PAYMENT_PROVIDER', `The payment provider refused the session: ${e.message}`);
  }
}

/** held → confirmed (or a free booking just inserted): emails + .ics + CRM event. Idempotent. */
async function finalize(b, origin, via, payment = {}) {
  let row = b;
  if (b.status !== 'confirmed') {
    row = await tx(async (t) => {
      const [cur] = await t.q('select * from bookings where id = $1 for update', [b.id]);
      if (!cur || cur.status === 'confirmed' || cur.status === 'cancelled') return null;
      if (cur.status === 'expired') {
        // paid after the hold lapsed: keep it if the slot is still free, otherwise flag for a refund
        const clash = await t.q("select 1 from bookings where slot_start = $1 and status in ('held','confirmed') and id <> $2", [cur.slot_start, cur.id]);
        if (clash.length) {
          await t.q('update bookings set payment_intent = $2 where id = $1', [cur.id, payment.paymentIntent || null]);
          await t.q("insert into events (source, type, ref, data) values ('system','booking.needs_refund',$1,$2::jsonb)", [cur.id, JSON.stringify({ reason: 'paid after hold expired; slot re-booked' })]);
          return null;
        }
      }
      const [u] = await t.q("update bookings set status = 'confirmed', confirmed_at = now(), payment_intent = coalesce($2, payment_intent) where id = $1 returning *", [cur.id, payment.paymentIntent || null]);
      return u;
    });
    if (!row) return one('select * from bookings where id = $1', [b.id]);
  }
  const ics = buildIcs(row);
  await Promise.all([mail.bookingConfirmed(row, ics, origin), mail.bookingOwnerEmail(row, origin)]);
  await emitEvent('booking.confirmed', { booking: { ...publicBooking(row), name: row.name, email: row.email, company: row.company }, via }, { ref: row.id });
  return row;
}

export function buildIcs(b) {
  const stamp = (d) => iso(d).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (x) => String(x).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hussain Singapuri//Calls//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${b.id}@hussain-singapuri`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(b.slot_start)}`, `DTEND:${stamp(b.slot_end)}`,
    `SUMMARY:${esc(`${b.service_name} with Hussain Singapuri`)}`, `DESCRIPTION:${esc(b.notes || 'Video link follows the day before.')}`,
    'LOCATION:Video call', `ORGANIZER;CN=Hussain Singapuri:mailto:${config.ownerEmail}`,
    `ATTENDEE;CN=${esc(b.name)};RSVP=TRUE:mailto:${b.email}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function paymentFrom(cs) {
  return { paymentIntent: typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id || null };
}

export async function handleGetBooking(req, res, ctx) {
  await sweepHolds();
  let b = await one('select * from bookings where id = $1', [ctx.params.id]);
  if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'No such booking');
  const sid = ctx.url.searchParams.get('session_id');
  if (['held', 'expired'].includes(b.status) && sid && sid === b.stripe_session_id && stripe.stripeEnabled()) {
    try {
      const cs = await stripe.retrieveSession(sid);
      if (cs.payment_status === 'paid') b = await finalize(b, ctx.origin, 'return', paymentFrom(cs));
    } catch (e) { console.error('[stripe] retrieve', e.message); }
  }
  sendJson(req, res, 200, { booking: publicBooking(b) });
}

export async function handleRelease(req, res, ctx) {
  const b = await one("select * from bookings where id = $1 and status = 'held'", [ctx.params.id]);
  if (b) {
    if (b.stripe_session_id && stripe.stripeEnabled()) { try { await stripe.expireSession(b.stripe_session_id); } catch { /* already gone */ } }
    const r = await q("update bookings set status = 'cancelled' where id = $1 and status = 'held' returning id", [b.id]);
    if (r.length) await emitEvent('booking.released', { id: b.id }, { source: 'system', ref: b.id });
  }
  sendJson(req, res, 200, { ok: true });
}

const TEST_CARDS = { '4242424242424242': true, '4000000000000002': false };
export async function handleTestConfirm(req, res, ctx) {
  if (stripe.stripeEnabled()) throw new HttpError(400, 'USE_STRIPE', 'Payments go through Stripe Checkout on this deployment.');
  const { body } = await readJson(req);
  await sweepHolds();
  const b = await one('select * from bookings where id = $1', [ctx.params.id]);
  if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'No such booking');
  if (b.status === 'confirmed') return sendJson(req, res, 200, { status: 'confirmed', booking: publicBooking(b) });
  if (b.status !== 'held') throw new HttpError(410, 'HOLD_EXPIRED', 'This hold expired and the slot was released — please pick a slot again.');
  const card = String(body.card_number || '').replace(/[\s-]/g, '');
  if (!(card in TEST_CARDS)) throw new HttpError(400, 'INVALID_CARD', 'Test mode: use 4242 4242 4242 4242 (success) or 4000 0000 0000 0002 (decline)');
  if (!TEST_CARDS[card]) throw new HttpError(402, 'card_declined', 'Your card was declined. The slot stays held until the timer runs out.', { decline_code: 'generic_decline' });
  const done = await finalize(b, ctx.origin, 'test-card', { paymentIntent: `pi_test_${b.id.slice(3, 13)}` });
  sendJson(req, res, 200, { status: done.status, booking: publicBooking(done) });
}

// ---- Stripe webhook ----------------------------------------------------------------
export async function handleStripeWebhook(req, res, ctx, raw) {
  const secret = await stripe.webhookSecret();
  if (!stripe.verifySignature(raw, req.headers['stripe-signature'], secret)) {
    await q("insert into events (source, type, verified, data) values ('stripe','signature.invalid',false,'{}'::jsonb)");
    throw new HttpError(400, 'BAD_SIGNATURE', 'Invalid signature.');
  }
  const evt = JSON.parse(raw);
  const fresh = await q("insert into events (source, type, ref, verified, data) values ('stripe',$1,$2,true,$3::jsonb) on conflict (ref) where source = 'stripe' and verified do nothing returning id",
    [evt.type, evt.id, JSON.stringify({ object: evt.data?.object?.id })]);
  if (!fresh.length) return sendJson(req, res, 200, { received: true, duplicate: true });
  const o = evt.data?.object || {};
  const find = () => one('select * from bookings where stripe_session_id = $1 or id = $2', [o.id, o.metadata?.booking_id || o.client_reference_id || '']);
  if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
    const b = o.payment_status === 'paid' ? await find() : null;
    if (b) await finalize(b, ctx.origin, 'webhook', paymentFrom(o));
  } else if (evt.type === 'checkout.session.expired') {
    const b = await find();
    if (b) await q("update bookings set status = 'expired' where id = $1 and status = 'held'", [b.id]);
  } else if (evt.type === 'charge.refunded' && o.payment_intent) {
    await q('update bookings set refunded = greatest(refunded, $2) where payment_intent = $1', [o.payment_intent, o.amount_refunded || 0]);
  }
  sendJson(req, res, 200, { received: true });
}

// ---- admin actions -----------------------------------------------------------------
export async function cancelBooking(bookingId, origin, { refund = true } = {}) {
  const b = await one('select * from bookings where id = $1', [bookingId]);
  if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'No such booking');
  if (!['held', 'confirmed'].includes(b.status)) throw new HttpError(409, 'BAD_STATE', `This booking is ${b.status}.`);
  let refunded = 0;
  if (refund && b.status === 'confirmed' && b.amount > b.refunded && b.payment_intent) {
    if (!b.payment_intent.startsWith('pi_test_') && stripe.stripeEnabled()) await stripe.refund(b.payment_intent, b.amount - b.refunded);
    refunded = b.amount - b.refunded;
  }
  if (b.status === 'held' && b.stripe_session_id && stripe.stripeEnabled()) { try { await stripe.expireSession(b.stripe_session_id); } catch { /* gone */ } }
  await q("update bookings set status = 'cancelled', refunded = refunded + $2 where id = $1", [b.id, refunded]);
  if (b.status === 'confirmed') await mail.bookingCancelled(b, refunded, origin);
  await emitEvent('booking.cancelled', { id: b.id, refunded }, { ref: b.id });
  return refunded;
}
