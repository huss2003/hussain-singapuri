// sections/Enquiry.js — NEW: a real enquiry form (the original only had obfuscated mailto links).
// POST /api/enquiries { name, email, company, need, budget, timeline, message, website (honeypot), ts }
//  · client validation mirrors server rules (server/leads.js) and runs on blur + submit
//  · server 400 { fields } errors are shown inline under each field (aria-invalid + aria-describedby)
//  · 201 / 202 → success panel (202 = silently dropped as spam; the visitor sees the same thing)
//  · 429 → rate-limit message; network errors keep the typed data.
import { api } from '../core/api.js';
import { qs, qsa, esc } from '../core/env.js';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
// Same lists as server/leads.js
export const NEEDS = ['AI agent', 'Automation', 'Website', 'Full-stack app', 'Something else'];
export const BUDGETS = ['<$1k', '$1-5k', '$5-15k', '$15k+'];
export const TIMELINES = ['As soon as possible', 'Within a month', '1–3 months', 'Flexible'];
export const RULES = {
  name: (v) => (v.length < 2 || v.length > 100 ? 'Name must be 2–100 characters' : ''),
  email: (v) => (!EMAIL_RE.test(v) || v.length > 254 ? 'Enter a valid email address' : ''),
  company: (v) => (v.length > 100 ? 'Company must be at most 100 characters' : ''),
  need: (v) => (!NEEDS.includes(v) ? 'Choose what you need' : ''),
  budget: (v) => (!BUDGETS.includes(v) ? 'Choose a budget range' : ''),
  timeline: (v) => (!TIMELINES.includes(v) ? 'Choose a timeline' : ''),
  message: (v) => (v.length < 20 ? `Message must be at least 20 characters (${v.length}/20)` : v.length > 5000 ? 'Message must be at most 5000 characters' : ''),
};

/** Show/clear one inline error. Shared with the booking form. */
export function setFieldError(form, name, msg) {
  const input = form.elements[name];
  const err = form.querySelector(`#${input?.getAttribute('aria-describedby')?.split(' ')[0]}`);
  if (!input) return;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  if (err) { err.textContent = msg || ''; err.classList.toggle('is-visible', !!msg); }
}

export class Enquiry {
  constructor(el) {
    this.el = el;
    this.form = qs('.js-enquiry', el);
    this.status = qs('.js-status', el);
    this.form.elements.ts.value = String(Date.now());   // render time: server drops submits < 3s later
    this.touched = new Set();
    qsa('input, select, textarea', this.form).forEach((f) => {
      if (!RULES[f.name]) return;
      f.addEventListener('blur', () => { this.touched.add(f.name); this.check(f.name); });
      f.addEventListener('input', () => { if (this.touched.has(f.name)) this.check(f.name); });
    });
    this.form.addEventListener('submit', (e) => this.submit(e));
  }
  value(name) { return String(this.form.elements[name].value || '').trim(); }
  check(name) { const msg = RULES[name](this.value(name)); setFieldError(this.form, name, msg); return !msg; }

  async submit(e) {
    e.preventDefault();
    this.status.textContent = '';
    const names = Object.keys(RULES);
    names.forEach((n) => this.touched.add(n));
    const bad = names.filter((n) => !this.check(n));
    if (bad.length) {
      this.status.textContent = `Please fix ${bad.length} field${bad.length > 1 ? 's' : ''}.`;
      this.form.elements[bad[0]].focus();
      return;
    }
    const btn = qs('button[type="submit"]', this.form);
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending…';
    const body = Object.fromEntries(names.map((n) => [n, this.value(n)]));
    body.website = this.form.elements.website.value;
    body.ts = Number(this.form.elements.ts.value);
    try {
      const { data } = await api('/enquiries', { method: 'POST', body });
      this.success(body.name, data && data.id);
    } catch (err) {
      if (err.status === 400 && err.fields) {
        Object.entries(err.fields).forEach(([k, msg]) => setFieldError(this.form, k, msg));
        const first = Object.keys(err.fields)[0];
        this.status.textContent = err.message || 'Some fields need attention.';
        this.form.elements[first] && this.form.elements[first].focus();
      } else if (err.status === 429) {
        this.status.textContent = 'Too many messages from this connection — please try again in a few minutes.';
      } else {
        this.status.textContent = err.message || 'Something went wrong. Please try again.';
      }
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Send enquiry';
    }
  }

  success(name, id) {
    const panel = document.createElement('div');
    panel.className = 'success-panel';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'status');
    panel.innerHTML = `<span class="success-panel__big">Received</span>
      <p>Thanks ${esc(name.split(' ')[0])} — your message is in. A confirmation is on its way to your inbox and I'll reply within two working days.</p>
      <p class="form__note">${id ? `Reference ${esc(id)} · ` : ''}Want to talk sooner? <a class="u-link" href="/book">Book a free intro call</a></p>`;
    this.form.replaceWith(panel);
    panel.focus();
  }
}
