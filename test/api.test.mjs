// Backend end-to-end tests: real HTTP against the server on a random port, Postgres via
// in-memory PGlite, built-in test card instead of Stripe. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PGLITE_MEMORY = '1';
process.env.QUIET = '1';
process.env.MIN_FORM_MS = '50';
process.env.TRUST_PROXY = '1';
for (const k of ['STRIPE_SECRET_KEY', 'DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY']) delete process.env[k];
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password-1';

const { start } = await import('../server/server.js');
let server, base;
before(async () => { server = await start({ port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }));

function client(ip = '10.0.0.1') {
  const jar = new Map();
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { origin: base, 'x-real-ip': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(body && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}
const enquiry = (over = {}) => ({ name: 'Maria Lopez', email: 'maria@example.com', company: 'Lopez Plumbing', need: 'AI agent', budget: '$5-15k', timeline: 'Within a month', message: 'We miss calls after 5pm and want an AI receptionist.', website: '', ts: Date.now() - 5000, ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('content: projects, credentials, services come from Postgres', async () => {
  const { status, data } = await client()('GET', '/api/content');
  assert.equal(status, 200);
  assert.equal(data.projects.length, 13);
  assert.equal(data.site.owner, 'Hussain Singapuri');
  assert.deepEqual(data.services.map((s) => s.id), ['intro', 'strategy']);
});

test('SEO: home is server-rendered with Person JSON-LD and a CSP nonce; unknown paths 404', async () => {
  const c = client();
  const home = await c('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.data, /<title>Hussain Singapuri — Full-stack developer &amp; AI engineer/);
  assert.match(home.data, /"@type":"Person"/);
  assert.match(home.headers.get('content-security-policy'), /nonce-/);
  assert.equal((await c('GET', '/nope')).status, 404);
});

test('enquiry: validation, bot traps answer 202 without storing, valid → 201', async () => {
  const c = client('10.0.0.2');
  const bad = await c('POST', '/api/enquiries', enquiry({ email: 'nope', need: 'Rocket' }));
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.email && bad.data.fields.need);
  assert.equal((await c('POST', '/api/enquiries', enquiry({ website: 'http://spam' }))).status, 202);
  assert.equal((await c('POST', '/api/enquiries', enquiry({ ts: Date.now() }))).status, 202);
  const ok = await c('POST', '/api/enquiries', enquiry());
  assert.equal(ok.status, 201);
  assert.match(ok.data.id, /^lead_/);
});

test('enquiry: rate limited per IP (shared counter in Postgres)', async () => {
  const c = client('10.0.0.3');
  let last;
  for (let i = 0; i < 6; i++) last = await c('POST', '/api/enquiries', enquiry({ message: `Attempt number ${i} for the rate limit test.` }));
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('CSRF: mutating API calls from a foreign origin are refused', async () => {
  const r = await client()('POST', '/api/enquiries', enquiry(), { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('free intro call: confirmed at once; the same slot cannot be booked twice', async () => {
  const c = client('10.0.1.1');
  const av = await c('GET', '/api/availability?service=intro');
  assert.equal(av.data.timezone, 'Asia/Kolkata');
  const slot = av.data.slots[0].id;
  const b = await c('POST', '/api/bookings', { service: 'intro', slot, name: 'Ada Vega', email: 'ada@example.com' });
  assert.equal(b.status, 201);
  assert.equal(b.data.status, 'confirmed');
  const again = await client('10.0.1.2')('POST', '/api/bookings', { service: 'strategy', slot, name: 'Bo', email: 'bo@example.com' });
  assert.equal(again.status, 409);
  assert.ok(!(await c('GET', '/api/availability?service=intro')).data.slots.some((s) => s.id === slot));
});

test('paid session: held, declined card keeps the hold, test card confirms, idempotent', async () => {
  const c = client('10.0.2.1');
  const slot = (await c('GET', '/api/availability?service=strategy')).data.slots[1].id;
  const b = await c('POST', '/api/bookings', { service: 'strategy', slot, name: 'Bo Chen', email: 'bo@example.com', notes: 'RAG over our docs' });
  assert.equal(b.status, 201);
  assert.equal(b.data.status, 'held');
  assert.equal(b.data.provider, 'test');
  const id = b.data.booking_id;
  assert.equal((await c('POST', `/api/bookings/${id}/confirm`, { card_number: '4000 0000 0000 0002' })).status, 402);
  const ok = await c('POST', `/api/bookings/${id}/confirm`, { card_number: '4242 4242 4242 4242' });
  assert.equal(ok.data.status, 'confirmed');
  assert.equal(ok.data.booking.amount, 9900);
  assert.equal((await c('POST', `/api/bookings/${id}/confirm`, { card_number: '4242424242424242' })).data.status, 'confirmed');
});

test('released hold frees the slot (Stripe cancel_url path)', async () => {
  const c = client('10.0.3.1');
  const slot = (await c('GET', '/api/availability?service=strategy')).data.slots[2].id;
  const b = await c('POST', '/api/bookings', { service: 'strategy', slot, name: 'Cy', email: 'cy@example.com' });
  await c('POST', `/api/bookings/${b.data.booking_id}/release`, {});
  assert.equal((await c('GET', `/api/bookings/${b.data.booking_id}`)).data.booking.status, 'cancelled');
  assert.ok((await c('GET', '/api/availability?service=strategy')).data.slots.some((s) => s.id === slot));
});

test('admin: login required; lead pipeline, project reorder and booking cancel work', async () => {
  const c = client('10.0.4.1');
  assert.equal((await c('GET', '/admin/leads')).status, 303);
  const form = (o) => new URLSearchParams(o).toString();
  const h = { 'content-type': 'application/x-www-form-urlencoded' };
  assert.equal((await c('POST', '/admin/login', form({ email: 'admin@test.local', password: 'wrong-pass' }), h)).status, 401);
  assert.equal((await c('POST', '/admin/login', form({ email: 'admin@test.local', password: 'admin-password-1' }), h)).status, 303);
  const dash = await c('GET', '/admin');
  assert.match(dash.data, /New leads/);
  const leads = await c('GET', '/admin/leads');
  const leadId = leads.data.match(/\/admin\/leads\/(lead_[\w-]+)/)[1];
  const save = await c('POST', `/admin/leads/${leadId}`, form({ status: 'proposal', notes: 'Sent a proposal' }), h);
  assert.match(save.headers.get('location'), /note=Saved/);
  await c('POST', '/admin/projects/orbital-surplus/move', form({ dir: 'down' }), h);
  await sleep(10);
  assert.equal((await c('GET', '/api/content')).data.projects[0].slug, 'nightjar-and-co');
  const calls = await c('GET', '/admin/bookings');
  const bk = calls.data.match(/\/admin\/bookings\/(bk_[\w-]+)\/cancel/)[1];
  const cancel = await c('POST', `/admin/bookings/${bk}/cancel`, '', h);
  assert.match(cancel.headers.get('location'), /Cancelled/);
  assert.equal((await c('POST', '/admin/projects/nanoserve/toggle', '', { ...h, origin: 'https://evil.example' })).status, 403);
});

test('Stripe webhook rejects bad signatures', async () => {
  const r = await client()('POST', '/api/webhooks/stripe', JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }), { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' });
  assert.equal(r.status, 400);
});
