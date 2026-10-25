// server/email.js
// -----------------------------------------------------------------------------
// Transactional email. Every message is written to the `emails` table (the admin
// "Email log" previews it). With RESEND_API_KEY set it is also sent through
// Resend, including .ics calendar attachments for booked calls.
// -----------------------------------------------------------------------------
import { q } from './db.js';
import { config } from './config.js';

const FROM = () => process.env.EMAIL_FROM || 'Hussain Singapuri <onboarding@resend.dev>';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (minor, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((minor || 0) / 100);

export async function sendEmail({ to, subject, html, kind = 'transactional', ref = null, replyTo, attachments }) {
  let status = 'logged';
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: FROM(), to: [to], subject, html, reply_to: replyTo,
          attachments: attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
        }),
      });
      status = r.ok ? 'sent' : `failed (${r.status})`;
    } catch { status = 'failed'; }
  }
  await q('insert into emails (to_email, subject, html, kind, status, ref) values ($1,$2,$3,$4,$5,$6)', [to, subject, html, kind, status, ref]);
  return status;
}

const VOLT = '#C6FF00', INK = '#0A0D00';
const frame = (title, body, origin = '') => `<!doctype html><html><body style="margin:0;background:${INK};font-family:Georgia,'Times New Roman',serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:${VOLT};border:1px solid ${INK}">
<tr><td style="padding:14px 24px;border-bottom:1px solid ${INK};font:700 12px/1 Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase">Hussain Singapuri — AI Engineer</td></tr>
<tr><td style="padding:28px 24px"><h1 style="font:400 34px/1.05 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;margin:0 0 16px">${title}</h1><div style="font-size:18px;line-height:1.5">${body}</div></td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${INK};font:11px/1.6 Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em">Building globally from Pune, India${origin ? ` · <a href="${origin}" style="color:${INK}">${esc(origin.replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;

const btn = (href, label) => `<p style="margin:22px 0 0"><a href="${href}" style="display:inline-block;background:${INK};color:${VOLT};padding:12px 18px;text-decoration:none;font:700 12px/1 Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase">${label}</a></p>`;
const rows = (pairs) => `<table role="presentation" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font:13px/1.4 Menlo,Consolas,monospace;margin:12px 0;width:100%">${pairs.filter(Boolean).map(([k, v]) => `<tr style="border-top:1px solid ${INK}"><td style="text-transform:uppercase;width:110px;vertical-align:top">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;

export function leadOwnerEmail(lead, origin) {
  return sendEmail({
    to: config.ownerEmail, replyTo: lead.email, kind: 'lead.owner', ref: lead.id,
    subject: `New enquiry: ${lead.name}${lead.company ? ` (${lead.company})` : ''} — ${lead.need}, ${lead.budget}`,
    html: frame('New enquiry', `${rows([['Name', lead.name], ['Email', lead.email], ['Company', lead.company || '—'], ['Need', lead.need], ['Budget', lead.budget], ['Timeline', lead.timeline]])}
      <p style="white-space:pre-wrap">${esc(lead.message)}</p>${btn(`${origin}/admin/leads/${lead.id}`, 'Open in pipeline')}`, origin),
  });
}

export function leadAutoReply(lead, origin) {
  return sendEmail({
    to: lead.email, kind: 'lead.auto_reply', ref: lead.id,
    subject: 'Got your message — Hussain Singapuri',
    html: frame(`Thanks, ${esc(lead.name.split(' ')[0])}`, `<p>Your message reached me. I read every enquiry myself and reply within two working days.</p>
      <p>Want to talk sooner? Grab a free 30-minute intro call.</p>${btn(`${origin}/book`, 'Book a call')}`, origin),
  });
}

export function bookingConfirmed(b, ics, origin) {
  const when = `${b.slot_local.replace('T', ' at ')} (${b.timezone})`;
  return sendEmail({
    to: b.email, kind: 'booking.invite', ref: b.id,
    subject: `Confirmed: ${b.service_name}, ${when}`,
    attachments: [{ filename: 'invite.ics', content: ics }],
    html: frame("You're booked", `<p>Hi ${esc(b.name.split(' ')[0])}, your call is confirmed. The calendar invite is attached; the video link arrives the day before.</p>
      ${rows([['Call', b.service_name], ['When', when], b.amount ? ['Paid', money(b.amount, b.currency)] : null, ['Reference', b.id]])}${btn(`${origin}/book/done/${b.id}`, 'View booking')}`, origin),
  });
}

export function bookingOwnerEmail(b, origin) {
  return sendEmail({
    to: config.ownerEmail, replyTo: b.email, kind: 'booking.owner', ref: b.id,
    subject: `New ${b.amount ? 'paid ' : ''}call: ${b.name} — ${b.slot_local.replace('T', ' ')}`,
    html: frame('New call booked', `${rows([['Name', b.name], ['Email', b.email], ['Company', b.company || '—'], ['Call', b.service_name], ['When', `${b.slot_local} ${b.timezone}`], b.amount ? ['Paid', money(b.amount, b.currency)] : null, ['Notes', b.notes || '—']])}${btn(`${origin}/admin/bookings`, 'Open bookings')}`, origin),
  });
}

export function bookingCancelled(b, refunded, origin) {
  return sendEmail({
    to: b.email, kind: 'booking.cancelled', ref: b.id,
    subject: `Cancelled: ${b.service_name}, ${b.slot_local.replace('T', ' ')}`,
    html: frame('Call cancelled', `<p>Your ${esc(b.service_name.toLowerCase())} on ${esc(b.slot_local.replace('T', ' at '))} (${esc(b.timezone)}) was cancelled.${refunded ? ` A refund of ${money(refunded, b.currency)} is on its way (5–10 business days).` : ''}</p>${btn(`${origin}/book`, 'Pick another time')}`, origin),
  });
}
