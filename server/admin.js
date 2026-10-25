// server/admin.js
// -----------------------------------------------------------------------------
// Studio admin under /admin: server-rendered, session login (users.is_admin),
// plain HTML forms with an Origin check against CSRF. No client JavaScript.
//
//   /admin            dashboard: new leads, upcoming calls, revenue, top projects
//   /admin/leads      pipeline new → contacted → proposal → won/lost, private notes
//   /admin/bookings   upcoming / past calls, cancel (with Stripe refund for paid calls)
//   /admin/projects   the work reel: edit, reorder, hide, add
//   /admin/emails · /admin/events · /admin/settings (Stripe webhook connect)
// -----------------------------------------------------------------------------
import { q, one } from './db.js';
import { HttpError, readRawBody, clientIp } from './http.js';
import { boot, refresh, bumpContent, allProjectRows } from './content.js';
import * as auth from './auth.js';
import * as stripe from './stripe.js';
import { esc, money } from './email.js';
import { cancelBooking, sweepHolds } from './bookings.js';
import { LEAD_STATUSES } from './leads.js';

const when = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const ist = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) + ' IST' : '—');

const CSS = `
:root{--bg:#0A0D00;--panel:#11150a;--line:#2a3214;--txt:#e9e9e9;--mute:#8a8a8a;--lime:#C6FF00;--red:#ff5a4f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:13px/1.5 "DM Mono",Menlo,Consolas,monospace}
a{color:var(--txt)}a:hover{color:var(--lime)}
.a-shell{display:grid;grid-template-columns:200px 1fr;min-height:100vh}
.a-side{border-right:1px solid var(--line);padding:18px 14px;display:grid;align-content:start;gap:4px;position:sticky;top:0;height:100vh}
.a-brand{font-size:13px;letter-spacing:.14em;margin:0 0 18px;display:block;text-decoration:none}.a-brand b{color:var(--lime)}
.a-side a.n{display:block;padding:6px 8px;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:12px;color:var(--mute)}
.a-side a.n.on,.a-side a.n:hover{color:var(--bg);background:var(--lime)}
.a-side form{margin-top:18px}
.a-main{padding:26px 32px 60px;min-width:0}
h1{font-size:18px;font-weight:400;letter-spacing:.1em;text-transform:uppercase;margin:0 0 18px}
h2{font-size:13px;font-weight:400;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin:26px 0 10px}
.a-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.a-stat{border:1px solid var(--line);background:var(--panel);padding:14px}.a-stat span{color:var(--mute);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.a-stat strong{display:block;font-size:22px;font-weight:400;margin-top:4px}
.a-table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line)}
.a-table th,.a-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.a-table th{font-weight:400;color:var(--mute);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.a-table tr:hover td{background:#121212}
.b{display:inline-block;padding:1px 6px;border:1px solid var(--line);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.b-paid{border-color:var(--lime);color:var(--lime)}.b-fulfilled{background:var(--lime);color:#000;border-color:var(--lime)}.b-pending{color:#ffd44f;border-color:#6b5a1a}
.b-cancelled,.b-expired,.b-lost,.b-hidden{color:var(--mute)}.b-new{color:#ffd44f;border-color:#6b5a1a}.b-contacted,.b-proposal,.b-held{color:#7fd1ff;border-color:#24506b}.b-confirmed,.b-won,.b-visible{border-color:var(--lime);color:var(--lime)}.b-refunded{color:var(--red);border-color:#5a2420}.b-draft{color:#ffd44f}.b-active{color:var(--lime)}
.a-btn,button{font:inherit;background:transparent;color:var(--lime);border:1px solid var(--lime);padding:7px 12px;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;font-size:12px}
.a-btn:hover,button:hover{background:var(--lime);color:#000}
button.ghost{color:var(--mute);border-color:var(--line)}button.danger{color:var(--red);border-color:#5a2420}button.danger:hover{background:var(--red);color:#000}
input,select,textarea{font:inherit;background:#000;color:var(--txt);border:1px solid var(--line);padding:7px 9px;width:100%}
input:focus,select:focus,textarea:focus{outline:1px solid var(--lime);border-color:var(--lime)}
label{display:block;font-size:11px;color:var(--mute);letter-spacing:.06em;text-transform:uppercase;margin:0 0 4px}
.a-form{display:grid;gap:12px;max-width:760px}.a-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.a-note{border:1px solid var(--lime);color:var(--lime);padding:9px 12px;margin:0 0 16px}.a-err{border-color:var(--red);color:var(--red)}
.a-cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);gap:22px;align-items:start}
.a-card{border:1px solid var(--line);background:var(--panel);padding:14px}.a-card dl{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;margin:0}.a-card dt{color:var(--mute)}.a-card dd{margin:0}
.a-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.a-actions form{display:flex;gap:8px;align-items:end}
.a-filter{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.a-filter a{padding:4px 8px;border:1px solid var(--line);text-decoration:none;font-size:11px;text-transform:uppercase}.a-filter a.on{border-color:var(--lime);color:var(--lime)}
.muted{color:var(--mute)}.lime{color:var(--lime)}.neg{color:var(--red)}
.thumb{width:44px;height:54px;object-fit:cover;background:#111;border:1px solid var(--line)}
.a-savebar{position:sticky;bottom:0;background:var(--bg);padding:12px 0;border-top:1px solid var(--line)}
.a-login{min-height:100vh;display:grid;place-items:center}.a-login form{width:min(360px,90vw);border:1px solid var(--line);background:var(--panel);padding:26px;display:grid;gap:12px}
iframe{width:100%;height:520px;border:1px solid var(--line);background:#000}
@media (max-width:800px){.a-shell{grid-template-columns:1fr}.a-side{position:static;height:auto;grid-template-columns:repeat(3,1fr)}.a-brand{grid-column:1/-1}.a-cols{grid-template-columns:1fr}.a-main{padding:18px}}
`;

const NAV = [['/admin', 'Dashboard'], ['/admin/leads', 'Leads'], ['/admin/bookings', 'Calls'], ['/admin/projects', 'Projects'], ['/admin/emails', 'Email log'], ['/admin/events', 'Events'], ['/admin/settings', 'Settings']];

function page(title, body, { path = '/admin', admin, note, err } = {}) {
  const nav = NAV.map(([href, label]) => `<a class="n${(href === '/admin' ? path === href : path.startsWith(href)) ? ' on' : ''}" href="${href}">${label}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — HS admin</title><link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"><style>${CSS}</style></head>
<body><div class="a-shell"><aside class="a-side"><a class="a-brand" href="/admin">HUSSAIN SINGAPURI <b>■</b><br><span class="muted">STUDIO ADMIN</span></a>${nav}
<a class="n" href="/" target="_blank" rel="noopener">View site ↗</a>
<form method="post" action="/admin/logout"><button class="ghost" type="submit">Sign out</button></form><p class="muted" style="font-size:11px;word-break:break-all">${esc(admin?.email || '')}</p></aside>
<main class="a-main">${note ? `<p class="a-note" role="status">${esc(note)}</p>` : ''}${err ? `<p class="a-note a-err" role="alert">${esc(err)}</p>` : ''}${body}</main></div></body></html>`;
}

const badge = (s) => `<span class="b b-${esc(s)}">${esc(s)}</span>`;
const table = (heads, rows, empty = 'Nothing here yet.') => rows.length
  ? `<table class="a-table"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
  : `<p class="muted">${empty}</p>`;
const formBody = async (req) => Object.fromEntries(new URLSearchParams(await readRawBody(req, 64 * 1024)));

// ---------------------------------------------------------------- pages
async function dashboard() {
  await sweepHolds();
  const [leadCounts, upcoming, rev, recentLeads, top, weekLeads] = await Promise.all([
    q('select status, count(*)::int as n from leads group by status'),
    q("select * from bookings where status = 'confirmed' and slot_start > now() order by slot_start limit 6"),
    one("select coalesce(sum(amount - refunded),0)::int as gross, count(*) filter (where amount > 0)::int as paid, count(*)::int as calls from bookings where status = 'confirmed'"),
    q('select id, name, company, need, budget, status, created_at from leads order by created_at desc limit 6'),
    q('select title, clicks from projects order by clicks desc, position limit 5'),
    one("select count(*)::int as n from leads where created_at > now() - interval '7 days'"),
  ]);
  const c = Object.fromEntries(leadCounts.map((r) => [r.status, r.n]));
  const total = leadCounts.reduce((s, r) => s + r.n, 0);
  const winRate = (c.won || 0) + (c.lost || 0) ? Math.round(((c.won || 0) / ((c.won || 0) + (c.lost || 0))) * 100) + '%' : '—';
  return ['Dashboard', `<h1>Dashboard</h1>
  <div class="a-stats">
    <div class="a-stat"><span>New leads</span><strong class="lime">${c.new || 0}</strong></div>
    <div class="a-stat"><span>Leads, last 7 days</span><strong>${weekLeads.n}</strong></div>
    <div class="a-stat"><span>All leads</span><strong>${total}</strong></div>
    <div class="a-stat"><span>Win rate</span><strong>${winRate}</strong></div>
    <div class="a-stat"><span>Calls booked</span><strong>${rev.calls}</strong></div>
    <div class="a-stat"><span>Paid sessions</span><strong>${rev.paid}</strong></div>
    <div class="a-stat"><span>Session revenue</span><strong>${money(rev.gross)}</strong></div>
  </div>
  <div class="a-cols" style="margin-top:8px"><section><h2>Latest leads</h2>${table(['Who', 'Need', 'Budget', 'Status', 'When'], recentLeads.map((l) => `<tr><td><a href="/admin/leads/${l.id}">${esc(l.name)}</a><br><span class="muted">${esc(l.company)}</span></td><td>${esc(l.need)}</td><td>${esc(l.budget)}</td><td>${badge(l.status)}</td><td class="muted">${when(l.created_at)}</td></tr>`), 'No enquiries yet.')}
  <h2>Most-clicked projects</h2>${table(['Project', 'Clicks'], top.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.clicks}</td></tr>`))}</section>
  <section><h2>Upcoming calls</h2>${table(['When', 'Who', 'Call'], upcoming.map((b) => `<tr><td>${ist(b.slot_start)}</td><td>${esc(b.name)}<br><span class="muted">${esc(b.email)}</span></td><td>${esc(b.service_name)}${b.amount ? `<br><span class="lime">${money(b.amount, b.currency)}</span>` : ''}</td></tr>`), 'No calls booked.')}</section></div>`];
}

async function leadsList(url) {
  const status = url.searchParams.get('status');
  const rows = await q(`select * from leads ${LEAD_STATUSES.includes(status) ? 'where status = $1' : ''} order by created_at desc limit 300`, LEAD_STATUSES.includes(status) ? [status] : []);
  const filt = `<div class="a-filter"><a href="/admin/leads" class="${!status ? 'on' : ''}">All</a>${LEAD_STATUSES.map((s) => `<a href="/admin/leads?status=${s}" class="${status === s ? 'on' : ''}">${s}</a>`).join('')}</div>`;
  return ['Leads', `<h1>Leads</h1>${filt}<p><a class="a-btn" href="/admin/leads.csv">Download CSV</a></p>${table(['Who', 'Need', 'Budget', 'Timeline', 'Status', 'Received'], rows.map((l) => `<tr><td><a href="/admin/leads/${l.id}">${esc(l.name)}</a><br><span class="muted">${esc(l.email)}${l.company ? ' · ' + esc(l.company) : ''}</span></td><td>${esc(l.need)}</td><td>${esc(l.budget)}</td><td>${esc(l.timeline)}</td><td>${badge(l.status)}</td><td class="muted">${when(l.created_at)}</td></tr>`), 'No leads match.')}`];
}

async function leadDetail(leadId) {
  const l = await one('select * from leads where id = $1', [leadId]);
  if (!l) return null;
  const calls = await q('select * from bookings where email = $1 order by slot_start desc', [l.email]);
  const ev = await q("select type, data, created_at from events where ref = $1 order by id", [l.id]);
  return [l.name, `<p><a href="/admin/leads" class="muted">← Leads</a></p><h1>${esc(l.name)} ${badge(l.status)}</h1>
  <div class="a-cols"><section><div class="a-card"><p style="white-space:pre-wrap;margin:0">${esc(l.message)}</p></div>
    <h2>Pipeline</h2><form class="a-form" method="post" action="/admin/leads/${l.id}">
      <div class="a-row"><div><label for="status">Status</label><select id="status" name="status">${LEAD_STATUSES.map((s) => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div><label for="notes">Private notes</label><textarea id="notes" name="notes" rows="5">${esc(l.notes)}</textarea></div>
      <div><button type="submit">Save</button> <a class="a-btn" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Re: your enquiry')}">Reply by email</a></div></form>
    <h2>Calls with this email</h2>${table(['When', 'Call', 'Status'], calls.map((b) => `<tr><td>${ist(b.slot_start)}</td><td>${esc(b.service_name)}</td><td>${badge(b.status)}</td></tr>`), 'None yet.')}
    <h2>Timeline</h2>${table(['When', 'Event', 'Detail'], ev.map((e) => `<tr><td class="muted">${when(e.created_at)}</td><td>${esc(e.type)}</td><td class="muted">${esc(e.type === 'lead.created' ? '' : JSON.stringify(e.data || ''))}</td></tr>`))}
  </section><aside class="a-card"><dl>
    <dt>Email</dt><dd><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></dd><dt>Company</dt><dd>${esc(l.company || '—')}</dd>
    <dt>Need</dt><dd>${esc(l.need)}</dd><dt>Budget</dt><dd>${esc(l.budget)}</dd><dt>Timeline</dt><dd>${esc(l.timeline)}</dd>
    <dt>Received</dt><dd>${when(l.created_at)}</dd><dt>Updated</dt><dd>${when(l.updated_at)}</dd>
    <dt>Referrer</dt><dd class="muted" style="word-break:break-all">${esc(l.referer || '—')}</dd><dt>IP hash</dt><dd class="muted">${esc(l.ip_hash || '')}</dd>
  </dl></aside></div>`];
}

async function bookingsList(url) {
  await sweepHolds();
  const scope = url.searchParams.get('scope') || 'upcoming';
  const where = scope === 'upcoming' ? "where slot_start > now() - interval '2 hours' and status in ('confirmed','held')" : '';
  const rows = await q(`select * from bookings ${where} order by slot_start ${scope === 'upcoming' ? 'asc' : 'desc'} limit 300`);
  const filt = `<div class="a-filter"><a href="/admin/bookings" class="${scope === 'upcoming' ? 'on' : ''}">Upcoming</a><a href="/admin/bookings?scope=all" class="${scope === 'all' ? 'on' : ''}">All</a></div>`;
  return ['Calls', `<h1>Calls</h1>${filt}${table(['When (IST)', 'Who', 'Call', 'Paid', 'Status', ''], rows.map((b) => `<tr><td>${ist(b.slot_start)}<br><span class="muted">${esc(b.id)}</span></td><td>${esc(b.name)}<br><span class="muted">${esc(b.email)}${b.company ? ' · ' + esc(b.company) : ''}</span>${b.notes ? `<br><span class="muted" style="white-space:pre-wrap">${esc(b.notes)}</span>` : ''}</td><td>${esc(b.service_name)}</td><td>${b.amount ? money(b.amount, b.currency) : 'free'}${b.refunded ? `<br><span class="neg">−${money(b.refunded, b.currency)}</span>` : ''}</td><td>${badge(b.status)}</td><td>${['confirmed', 'held'].includes(b.status) ? `<form method="post" action="/admin/bookings/${b.id}/cancel"><button class="danger" type="submit">Cancel${b.amount && b.status === 'confirmed' ? ' + refund' : ''}</button></form>` : ''}</td></tr>`), 'No calls.')}`];
}

async function projectsList() {
  await refresh();
  const rows = allProjectRows();
  return ['Projects', `<h1>Projects</h1><p class="muted">The work reel on the homepage, top to bottom. Hidden projects stay here but leave the site.</p><p><a class="a-btn" href="/admin/projects/new">+ New project</a></p>
  ${table(['', 'Project', 'Kind', 'Clicks', 'Status', 'Order'], rows.map((p, i) => `<tr><td><img class="thumb" style="width:96px;height:56px" src="${esc(p.poster)}" alt=""></td><td><a href="/admin/projects/${p.slug}">${esc(p.title)}</a><br><span class="muted">${esc(p.clip)} · ${esc((p.tags || []).join(', '))}</span></td><td>${esc(p.kind)}</td><td>${p.clicks}</td><td>${badge(p.visible ? 'visible' : 'hidden')}</td>
    <td><div class="a-actions"><form method="post" action="/admin/projects/${p.slug}/move"><input type="hidden" name="dir" value="up"><button class="ghost" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button></form><form method="post" action="/admin/projects/${p.slug}/move"><input type="hidden" name="dir" value="down"><button class="ghost" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></form><form method="post" action="/admin/projects/${p.slug}/toggle"><button class="ghost">${p.visible ? 'Hide' : 'Show'}</button></form></div></td></tr>`))}`];
}

function projectForm(p, action) {
  const v = (k) => esc(p?.[k] ?? '');
  return `<form class="a-form" method="post" action="${action}">
  <div class="a-row"><div><label for="title">Title</label><input id="title" name="title" required maxlength="60" value="${v('title')}"></div>
    <div><label for="clip">Category line</label><input id="clip" name="clip" maxlength="40" value="${v('clip')}" placeholder="RAG chat agent"></div>
    <div><label for="kind">Kind</label><select id="kind" name="kind"><option ${p?.kind === 'web' ? 'selected' : ''}>web</option><option ${p?.kind === 'ai' ? 'selected' : ''}>ai</option></select></div></div>
  <div class="a-row"><div><label for="url">Link (live site or repo)</label><input id="url" name="url" type="url" required value="${v('url')}"></div><div><label for="repo">Repository</label><input id="repo" name="repo" type="url" value="${v('repo')}"></div></div>
  <div class="a-row"><div><label for="tags">Tags (comma separated)</label><input id="tags" name="tags" value="${esc((p?.tags || []).join(', '))}"></div><div><label for="year">Year</label><input id="year" name="year" inputmode="numeric" value="${v('year')}"></div></div>
  <div><label for="poster">Poster image path (1082×636)</label><input id="poster" name="poster" value="${v('poster')}" placeholder="/images/work/my-project.jpg"></div>
  <div><label for="summary">Summary (one or two sentences)</label><textarea id="summary" name="summary" rows="3" maxlength="300">${v('summary')}</textarea></div>
  <label class="muted" style="display:flex;gap:8px;align-items:center;text-transform:none"><input type="checkbox" name="visible" style="width:auto" ${p?.visible === false ? '' : 'checked'}> Show on the site</label>
  <div class="a-savebar"><button type="submit">Save project</button></div></form>`;
}

async function saveProject(b, slug) {
  const title = String(b.title || '').trim().slice(0, 60);
  let url = String(b.url || '').trim();
  if (!title || !/^https?:\/\//.test(url)) throw new HttpError(400, 'VALIDATION', 'Title and an http(s) link are required.');
  const repo = String(b.repo || '').trim();
  if (repo && !/^https?:\/\//.test(repo)) throw new HttpError(400, 'VALIDATION', 'Repository must be an http(s) link.');
  const tags = String(b.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6);
  const year = Number.parseInt(b.year, 10) || null;
  const fields = [title, String(b.clip || '').slice(0, 40), b.kind === 'ai' ? 'ai' : 'web', url, repo, JSON.stringify(tags), year,
    String(b.poster || '').trim() || '/images/work/placeholder.jpg', String(b.summary || '').slice(0, 300), b.visible === 'on'];
  if (slug) {
    const r = await q('update projects set title=$2, client=$2, clip=$3, kind=$4, url=$5, repo=$6, tags=$7::jsonb, year=$8, poster=$9, summary=$10, visible=$11, updated_at=now() where slug=$1 returning slug', [slug, ...fields]);
    if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  } else {
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || `project-${Date.now()}`;
    if ((await q('select 1 from projects where slug = $1', [slug])).length) slug = `${slug}-${Date.now().toString(36)}`;
    await q(`insert into projects (slug, title, client, clip, kind, url, repo, tags, year, poster, summary, visible, position)
      values ($1,$2,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,(select coalesce(max(position),0)+1 from projects))`, [slug, ...fields]);
  }
  await bumpContent();
  return slug;
}

async function moveProject(slug, dir) {
  const rows = await q('select id, slug from projects order by position, id');
  const i = rows.findIndex((r) => r.slug === slug);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (const [k, r] of rows.entries()) await q('update projects set position = $2 where id = $1', [r.id, k]);
  await bumpContent();
}

async function simpleList(kind, url) {
  if (kind === 'emails') {
    const idq = Number(url.searchParams.get('id') || 0);
    if (idq) {
      const e = await one('select * from emails where id = $1', [idq]);
      if (!e) return null;
      return ['Email', `<p><a href="/admin/emails" class="muted">← Email log</a></p><h1>${esc(e.subject)}</h1><p class="muted">To ${esc(e.to_email)} · ${when(e.created_at)} · ${esc(e.status)}</p><iframe sandbox="" srcdoc="${esc(e.html)}" title="Email preview"></iframe>`];
    }
    const rows = await q('select id, to_email, subject, kind, status, created_at from emails order by id desc limit 200');
    return ['Email log', `<h1>Email log</h1><p class="muted">${process.env.RESEND_API_KEY ? 'Sending through Resend.' : 'RESEND_API_KEY is not set: emails are logged here instead of being sent.'}</p>${table(['To', 'Subject', 'Kind', 'Status', 'When'], rows.map((e) => `<tr><td>${esc(e.to_email)}</td><td><a href="/admin/emails?id=${e.id}">${esc(e.subject)}</a></td><td>${esc(e.kind)}</td><td>${esc(e.status)}</td><td class="muted">${when(e.created_at)}</td></tr>`))}`];
  }
  if (kind === 'events') {
    const rows = await q('select * from events order by id desc limit 200');
    return ['Events', `<h1>Events</h1><p class="muted">Stripe webhooks (deduplicated by event id), CRM events (lead.created, booking.confirmed …) and system events.</p>${table(['When', 'Source', 'Type', 'Ref', 'Verified', 'Data'], rows.map((e) => `<tr><td class="muted">${when(e.created_at)}</td><td>${esc(e.source)}</td><td>${esc(e.type)}</td><td>${(e.ref || '').startsWith('lead_') ? `<a href="/admin/leads/${esc(e.ref)}">${esc(e.ref)}</a>` : esc(e.ref || '')}</td><td>${e.verified ? 'yes' : '<span class="neg">no</span>'}</td><td class="muted" style="max-width:340px;word-break:break-all">${esc(e.data ? JSON.stringify(e.data).slice(0, 300) : '')}</td></tr>`))}`];
  }
  return null;
}

async function settingsPage(origin) {
  const wh = await one("select value from meta where key = 'stripe_webhook_secret'");
  const mode = stripe.stripeEnabled() ? (stripe.stripeTestMode() ? 'Stripe test mode' : 'Stripe LIVE mode') : 'Built-in test card (no STRIPE_SECRET_KEY)';
  return ['Settings', `<h1>Settings</h1><div class="a-card"><dl>
    <dt>Payments</dt><dd>${esc(mode)}</dd>
    <dt>Webhook</dt><dd>${process.env.STRIPE_WEBHOOK_SECRET ? 'STRIPE_WEBHOOK_SECRET env var' : wh ? `Connected → ${esc(wh.value.url)}` : '<span class="neg">Not connected</span>'}</dd>
    <dt>Email</dt><dd>${process.env.RESEND_API_KEY ? 'Resend' : 'Logged only (set RESEND_API_KEY to send)'}</dd>
    <dt>CRM webhook</dt><dd>${process.env.CRM_WEBHOOK_URL ? 'CRM_WEBHOOK_URL set' : 'Not set (events are logged only)'}</dd>
    <dt>Database</dt><dd>${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Postgres (Neon)' : 'PGlite (local)'}</dd>
    <dt>Origin</dt><dd>${esc(origin)}</dd></dl></div>
  ${stripe.stripeEnabled() ? `<h2>Stripe webhook</h2><p class="muted">Registers ${esc(origin)}/api/webhooks/stripe for checkout.session.completed / expired and charge.refunded, and stores the signing secret.</p>
  <form method="post" action="/admin/settings/webhook"><button type="submit">${wh ? 'Reconnect' : 'Connect'} webhook</button></form>` : ''}`];
}

// ---------------------------------------------------------------- entry
function sameOrigin(req, origin) {
  const o = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '');
  return !o || o === origin;
}
const redirect = (res, to, cookie) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(); };
const html = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end(body); };

function loginPage(err, next = '/admin') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sign in — HS admin</title><style>${CSS}</style></head>
  <body><main class="a-login"><form method="post" action="/admin/login"><p class="a-brand">HUSSAIN SINGAPURI <b>■</b><br><span class="muted">STUDIO ADMIN</span></p>
  ${err ? `<p class="a-note a-err" role="alert">${esc(err)}</p>` : ''}<input type="hidden" name="next" value="${esc(next)}">
  <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
  <div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
  <button type="submit">Sign in</button><a class="muted" href="/">← Back to the site</a></form></main></body></html>`;
}

export async function handleAdmin(ctx) {
  const { req, res, url, origin, secure } = ctx;
  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  const method = req.method;
  await boot();
  await auth.ensureAdmin();
  if (method === 'POST' && !sameOrigin(req, origin)) return html(res, 403, 'Cross-site request refused.');

  if (path === '/admin/login') {
    if (method === 'POST') {
      const b = await formBody(req);
      try {
        const u = await auth.login(b.email, b.password, clientIp(req));
        if (!u.is_admin) throw new auth.AuthError('This account does not have admin access.');
        const tok = await auth.createSession(u.id);
        const next = String(b.next || '/admin');
        return redirect(res, next.startsWith('/admin') ? next : '/admin', auth.sessionCookie(tok, secure));
      } catch (e) {
        if (!(e instanceof auth.AuthError)) throw e;
        return html(res, 401, loginPage(e.message, b.next));
      }
    }
    return html(res, 200, loginPage(null, url.searchParams.get('next') || '/admin'));
  }

  const admin = await auth.sessionCustomer(ctx.cookies.hs_sid);
  if (!admin?.is_admin) {
    if (method !== 'GET') return html(res, 401, 'Sign in first.');
    return redirect(res, `/admin/login?next=${encodeURIComponent(path)}`);
  }
  if (path === '/admin/logout' && method === 'POST') { await auth.destroySession(ctx.cookies.hs_sid); return redirect(res, '/admin/login', auth.clearSessionCookie(secure)); }

  const back = (to, msg, isErr = false) => redirect(res, `${to}${to.includes('?') ? '&' : '?'}${isErr ? 'err' : 'note'}=${encodeURIComponent(msg)}`);
  if (method === 'POST') {
    const b = await formBody(req);
    let m;
    const target = path.replace(/\/(cancel|move|toggle)$/, '');
    try {
      if ((m = path.match(/^\/admin\/leads\/(lead_[\w-]+)$/))) {
        if (!LEAD_STATUSES.includes(b.status)) throw new HttpError(400, 'VALIDATION', 'Unknown status.');
        const prev = await one('select status from leads where id = $1', [m[1]]);
        if (!prev) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
        await q('update leads set status = $2, notes = $3, updated_at = now() where id = $1', [m[1], b.status, String(b.notes || '').slice(0, 5000)]);
        if (prev.status !== b.status) await q("insert into events (source, type, ref, data) values ('admin','lead.status',$1,$2::jsonb)", [m[1], JSON.stringify({ from: prev.status, to: b.status })]);
        return back(path, 'Saved.');
      }
      if ((m = path.match(/^\/admin\/bookings\/(bk_[\w-]+)\/cancel$/))) { const r = await cancelBooking(m[1], origin); return back('/admin/bookings', r ? `Cancelled and refunded ${money(r)}.` : 'Cancelled.'); }
      if (path === '/admin/projects/new') { const slug = await saveProject(b, null); return back(`/admin/projects/${slug}`, 'Project added.'); }
      if ((m = path.match(/^\/admin\/projects\/([a-z0-9-]+)\/move$/))) { await moveProject(m[1], b.dir); return back('/admin/projects', 'Reordered.'); }
      if ((m = path.match(/^\/admin\/projects\/([a-z0-9-]+)\/toggle$/))) { await q('update projects set visible = not visible where slug = $1', [m[1]]); await bumpContent(); return back('/admin/projects', 'Updated.'); }
      if ((m = path.match(/^\/admin\/projects\/([a-z0-9-]+)$/))) { await saveProject(b, m[1]); return back(path, 'Saved. The site shows it on the next request.'); }
      if (path === '/admin/settings/webhook') { const ep = await stripe.connectWebhook(origin); return back('/admin/settings', `Webhook connected (${ep.id}).`); }
    } catch (e) {
      if (e instanceof HttpError) return back(target === path ? path : target.replace(/\/[^/]+$/, '') || '/admin', e.message, true);
      if (e.stripe) return back(target, `Stripe: ${e.message}`, true);
      throw e;
    }
    return html(res, 404, 'Not found');
  }

  if (path === '/admin/leads.csv') {
    const rows = await q('select id, created_at, status, name, email, company, need, budget, timeline from leads order by created_at');
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = 'id,created_at,status,name,email,company,need,budget,timeline\n' + rows.map((r) => [r.id, new Date(r.created_at).toISOString(), r.status, r.name, r.email, r.company, r.need, r.budget, r.timeline].map(cell).join(',')).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads.csv"', 'Cache-Control': 'no-store' });
    return res.end(csv);
  }

  let out = null, m;
  if (path === '/admin') out = await dashboard();
  else if (path === '/admin/leads') out = await leadsList(url);
  else if ((m = path.match(/^\/admin\/leads\/(lead_[\w-]+)$/))) out = await leadDetail(m[1]);
  else if (path === '/admin/bookings') out = await bookingsList(url);
  else if (path === '/admin/projects') out = await projectsList();
  else if (path === '/admin/projects/new') out = ['New project', `<p><a href="/admin/projects" class="muted">← Projects</a></p><h1>New project</h1>${projectForm(null, '/admin/projects/new')}`];
  else if ((m = path.match(/^\/admin\/projects\/([a-z0-9-]+)$/))) {
    await refresh();
    const p = allProjectRows().find((x) => x.slug === m[1]);
    if (p) out = [p.title, `<p><a href="/admin/projects" class="muted">← Projects</a></p><h1>${esc(p.title)} ${badge(p.visible ? 'visible' : 'hidden')}</h1>${projectForm(p, `/admin/projects/${p.slug}`)}`];
  } else if ((m = path.match(/^\/admin\/(emails|events)$/))) out = await simpleList(m[1], url);
  else if (path === '/admin/settings') out = await settingsPage(origin);
  if (!out) return html(res, 404, page('Not found', '<h1>Not found</h1>', { path, admin }));
  return html(res, 200, page(out[0], out[1], { path, admin, note: url.searchParams.get('note'), err: url.searchParams.get('err') }));
}
