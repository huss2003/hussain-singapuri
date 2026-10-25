// views/book.js — call booking.
//   /book            00 call type (free intro / paid strategy) → 01 slot (GET /api/availability?service=&month=)
//                    → 02 details → POST /api/bookings
//                      intro: confirmed straight away → /book/done/:id
//                      strategy: slot held 31 min → Stripe Checkout (payment_url) → /book/done/:id?session_id=…
//                    ?cancelled=:id (Stripe cancel_url) → POST /api/bookings/:id/release frees the slot at once
//   /book/pay/:id    built-in test card page, only when the server has no Stripe key
//   /book/done/:id   confirmation (the server confirms with Stripe before answering)
// Steps inside the flow navigate with history.pushState (router.navigate), so Back works.
import { api } from '../core/api.js';
import { esc, qs, qsa } from '../core/env.js';
import { setFieldError } from '../sections/Enquiry.js';

const STEPS = ['Pick a slot', 'Your details', 'Payment', 'Confirmed'];
const money = (minor, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function shell(step, title, lede, body, kicker = 'Book a call') {
  return `
  <section class="page" aria-labelledby="book-title">
    <div class="page__head">
      <p class="page__kicker">${esc(kicker)}</p>
      <h1 class="page__title" id="book-title">${title}</h1>
      ${lede ? `<p class="page__lede">${lede}</p>` : ''}
    </div>
    <div class="page-card">
      <ol class="steps" aria-label="Booking progress">${STEPS.map((s, i) => `<li${i === step ? ' aria-current="step"' : ''}${i < step ? ' class="is-done"' : ''}>${s}</li>`).join('')}</ol>
      <div class="page-card__body js-step">${body}</div>
    </div>
  </section>`;
}

function fmtSlot(slot, opts = {}) {
  const d = new Date(slot.start);
  const tz = slot.timezone || 'Asia/Kolkata';
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);
  const mine = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(d);
  const mineTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(d);
  return opts.short ? mineTime : `${date}, ${time} IST — ${mine} your time`;
}

// ---------------------------------------------------------------- 01 + 02
async function mountBook(root, ctx) {
  document.title = 'Book a call — Hussain Singapuri';
  let service = null, services = [], timezone = 'Asia/Kolkata', selected = null;
  const now = new Date();
  const months = [monthKey(now), monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1))];
  let mi = 0;
  const params = new URLSearchParams(location.search);
  const cancelled = params.get('cancelled');
  root.innerHTML = shell(0, 'Book a call', 'Talk to me about an AI agent, an automation, a website or a full-stack build. Times are US-friendly evenings in India.', '<p class="loading">Loading</p>');
  const body = qs('.js-step', root);
  if (cancelled) {
    try { await api(`/bookings/${encodeURIComponent(cancelled)}/release`, { method: 'POST', body: {} }); } catch { /* the hold expires anyway */ }
    history.replaceState({}, '', '/book');
  }

  async function chooseService() {
    let data;
    try { ({ data } = await api('/availability?service=intro')); }
    catch (err) { body.innerHTML = `<p class="form__status" role="alert">${esc(err.message || 'Could not load the calendar.')}</p>`; return; }
    services = data.services || [];
    timezone = data.timezone || timezone;
    body.innerHTML = `${cancelled ? '<p class="form__status" role="status">Payment cancelled — the slot was released. Pick again whenever you like.</p>' : ''}
      <div class="service-picks" role="group" aria-label="Call type">${services.map((svc) => `
        <button type="button" class="service-pick" data-id="${esc(svc.id)}">
          <span class="service-pick__price">${svc.price ? esc(money(svc.price, svc.currency)) : 'Free'}</span>
          <span class="service-pick__name">${esc(svc.name)}</span>
          <span class="service-pick__desc">${esc(svc.description)}</span>
          <span class="service-pick__cta">Choose →</span>
        </button>`).join('')}</div>
      <p class="form__note">Paid sessions are taken through Stripe in test mode for this portfolio: card 4242 4242 4242 4242, any future date, any CVC.</p>`;
    qsa('.service-pick', body).forEach((b) => b.addEventListener('click', () => {
      service = services.find((x) => x.id === b.dataset.id);
      qs('.page__kicker', root).textContent = `${service.name}${service.price ? ` · ${money(service.price, service.currency)}` : ' · free'}`;
      selected = null; mi = 0; loadMonth();
    }));
  }

  async function loadMonth() {
    body.innerHTML = '<p class="loading">Loading free slots</p>';
    let data;
    try { ({ data } = await api(`/availability?service=${encodeURIComponent(service.id)}&month=${months[mi]}`)); }
    catch (err) { body.innerHTML = `<p class="form__status" role="alert">${esc(err.message || 'Could not load availability.')}</p><button class="btn js-retry" type="button">Try again</button>`; qs('.js-retry', body).onclick = loadMonth; return; }
    service = data.service || service; timezone = data.timezone || timezone;
    const byDay = new Map();
    (data.slots || []).forEach((s) => { const k = (s.local || s.start).slice(0, 10); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${months[mi]}-01T12:00:00`));
    body.innerHTML = `
      <div class="slots__toolbar">
        <h2 class="slots__month" aria-live="polite">${esc(label)}</h2>
        <div class="slots__nav"><button class="icon-btn js-prev" type="button" aria-label="Previous month" ${mi === 0 ? 'disabled' : ''}>←</button><button class="icon-btn js-next" type="button" aria-label="Next month" ${mi === months.length - 1 ? 'disabled' : ''}>→</button></div>
      </div>
      <p class="slots__tz">Buttons show your local time · ${esc(service.name)} · ${service.price ? esc(money(service.price, service.currency)) : 'free'} · <button type="button" class="u-link js-change-service">change call type</button></p>
      ${byDay.size ? `<div class="slots__days" role="group" aria-label="Available slots">${[...byDay].map(([day, slots]) => {
        const d = new Date(`${day}T12:00:00`);
        return `<div class="slots__day"><span class="slots__date">${new Intl.DateTimeFormat('en-GB', { weekday: 'short', month: 'short' }).format(d)}<strong>${d.getDate()}</strong></span>
          <div class="slots__times">${slots.map((s) => `<button type="button" class="slot-btn" aria-pressed="${selected && selected.id === s.id}" data-id="${esc(s.id)}" aria-label="${esc(fmtSlot(s))}">${esc(fmtSlot(s, { short: true }))}</button>`).join('')}</div></div>`;
      }).join('')}</div>` : '<p class="slots__empty">No free slots this month — try the next one.</p>'}
      <p class="slots__selected js-selected" aria-live="polite">${selected ? `Selected: ${esc(fmtSlot(selected))}` : ''}</p>
      <div class="form__foot"><p class="form__note">${service.price ? 'Your slot is held for 30 minutes while you pay.' : 'Free, no card needed. You get a calendar invite by email.'}</p><button class="btn js-continue" type="button" ${selected ? '' : 'disabled'}>Continue</button></div>`;
    qs('.js-change-service', body).onclick = () => chooseService();
    qs('.js-prev', body).onclick = () => { mi = Math.max(0, mi - 1); loadMonth(); };
    qs('.js-next', body).onclick = () => { mi = Math.min(months.length - 1, mi + 1); loadMonth(); };
    qsa('.slot-btn', body).forEach((b) => b.addEventListener('click', () => {
      selected = data.slots.find((s) => s.id === b.dataset.id);
      qsa('.slot-btn', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      qs('.js-selected', body).textContent = `Selected: ${fmtSlot(selected)}`;
      qs('.js-continue', body).disabled = false;
    }));
    qs('.js-continue', body).onclick = () => details();
  }

  function details() {
    qsa('.steps li', root).forEach((li, i) => { li.toggleAttribute('aria-current', i === 1); if (i === 1) li.setAttribute('aria-current', 'step'); li.classList.toggle('is-done', i < 1); });
    body.innerHTML = `
      <dl class="summary"><dt>Call</dt><dd>${esc(service.name)}</dd><dt>Slot</dt><dd>${esc(fmtSlot(selected))}</dd><dt>Price</dt><dd>${service.price ? esc(money(service.price, service.currency)) : 'Free'}</dd></dl>
      <form class="form form--single js-book-form" novalidate style="padding:0">
        <div class="form__field"><label class="form__label" for="b-name">Name</label><input class="form__input" id="b-name" name="name" autocomplete="name" required aria-describedby="be-name"><p class="form__error" id="be-name" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="b-email">Email</label><input class="form__input" id="b-email" name="email" type="email" autocomplete="email" required aria-describedby="be-email"><p class="form__error" id="be-email" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="b-company">Company <span class="form__opt">optional</span></label><input class="form__input" id="b-company" name="company" autocomplete="organization" maxlength="100" aria-describedby="be-company"><p class="form__error" id="be-company" role="alert"></p></div>
        <div class="form__field"><label class="form__label" for="b-notes">What should we cover? <span class="form__opt">optional</span></label><textarea class="form__textarea" id="b-notes" name="notes" maxlength="1000" aria-describedby="be-notes"></textarea><p class="form__error" id="be-notes" role="alert"></p></div>
        <input type="hidden" name="slot" aria-describedby="be-slot"><p class="form__error" id="be-slot" role="alert"></p>
        <div class="form__foot"><button class="btn btn--ghost js-back" type="button">Change slot</button><button class="btn" type="submit">${service.price ? `Hold slot &amp; pay ${esc(money(service.price, service.currency))}` : 'Book free call'}</button></div>
        <p class="form__status js-status" role="status" aria-live="polite"></p>
      </form>`;
    const form = qs('.js-book-form', body);
    qs('#b-name', form).focus();
    qs('.js-back', form).onclick = () => { qsa('.steps li', root).forEach((li, i) => { li.removeAttribute('aria-current'); li.classList.remove('is-done'); if (i === 0) li.setAttribute('aria-current', 'step'); }); loadMonth(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = { name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), company: form.elements.company.value.trim(), notes: form.elements.notes.value.trim() };
      const errs = {
        name: v.name.length < 2 ? 'Name must be 2–100 characters' : '',
        email: !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.email) ? 'Enter a valid email address' : '',
        notes: v.notes.length > 1000 ? 'Notes must be at most 1000 characters' : '',
      };
      Object.entries(errs).forEach(([k, m]) => setFieldError(form, k, m));
      const first = Object.keys(errs).find((k) => errs[k]);
      if (first) { form.elements[first].focus(); return; }
      const btn = qs('button[type="submit"]', form), status = qs('.js-status', form);
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); status.textContent = '';
      try {
        const { data } = await api('/bookings', { method: 'POST', body: { service: service.id, slot: selected.id, ...v } });
        if (/^https:\/\//.test(data.pay_url || '')) { btn.textContent = 'Opening Stripe…'; window.location.assign(data.pay_url); return; }
        ctx.router.navigate(data.next || data.pay_url || `/book/pay/${data.booking_id}`);
      } catch (err) {
        btn.disabled = false; btn.removeAttribute('aria-busy');
        if (err.status === 409) { status.textContent = err.message || 'That slot was just taken — pick another.'; selected = null; setTimeout(() => qs('.js-back', form).click(), 1800); }
        else if (err.status === 400 && err.fields) { Object.entries(err.fields).forEach(([k, m]) => setFieldError(form, k, m)); status.textContent = err.message; }
        else status.textContent = err.message || 'Could not hold the slot. Please try again.';
      }
    });
  }

  await chooseService();
  return { destroy() {} };
}

// ---------------------------------------------------------------- 03
async function mountPay(root, ctx) {
  document.title = 'Payment — Hussain Singapuri';
  const id = ctx.route.id;
  root.innerHTML = shell(2, 'Payment', 'Local test mode — this server has no Stripe key, so a built-in test card stands in for Stripe Checkout.', '<p class="loading">Loading your booking</p>');
  const body = qs('.js-step', root);
  let booking;
  try { ({ data: { booking } } = await api(`/bookings/${encodeURIComponent(id)}`)); }
  catch (err) { body.innerHTML = `<p class="form__status" role="alert">${esc(err.status === 404 ? 'We could not find that booking.' : err.message)}</p><a class="btn" href="/book">Start again</a>`; return { destroy() {} }; }
  if (booking.status === 'confirmed') { ctx.router.navigate(`/book/done/${id}`, { replace: true }); return { destroy() {} }; }
  if (booking.status !== 'held') { body.innerHTML = `<p class="form__status" role="alert">This hold has ${esc(booking.status)} and the slot was released.</p><a class="btn" href="/book">Pick a new slot</a>`; return { destroy() {} }; }

  body.innerHTML = `
    <dl class="summary"><dt>Call</dt><dd>${esc(booking.service?.name || 'Call')}</dd><dt>Slot</dt><dd>${esc(fmtSlot(booking.slot))}</dd><dt>Price</dt><dd>${esc(money(booking.amount, booking.currency))}</dd><dt>Hold</dt><dd><span class="timer js-timer" aria-live="off">--:--</span></dd></dl>
    <div class="test-card"><strong>Test cards</strong><br>
      Success <code>4242 4242 4242 4242</code><button type="button" class="js-fill" data-card="4242 4242 4242 4242">Use</button><br>
      Declined <code>4000 0000 0000 0002</code><button type="button" class="js-fill" data-card="4000 0000 0000 0002">Use</button><br>
      Any future expiry · any 3-digit CVC.</div>
    <form class="form js-pay-form" novalidate style="padding:0">
      <div class="form__field form__field--full"><label class="form__label" for="p-card">Card number</label><input class="form__input" id="p-card" name="card_number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23" required aria-describedby="pe-card"><p class="form__error" id="pe-card" role="alert"></p></div>
      <div class="form__field"><label class="form__label" for="p-exp">Expiry</label><input class="form__input" id="p-exp" name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / YY" maxlength="7" required aria-describedby="pe-exp"><p class="form__error" id="pe-exp" role="alert"></p></div>
      <div class="form__field"><label class="form__label" for="p-cvc">CVC</label><input class="form__input" id="p-cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" required aria-describedby="pe-cvc"><p class="form__error" id="pe-cvc" role="alert"></p></div>
      <div class="form__foot"><p class="form__note">Never type a real card here — this is a demo.</p><button class="btn" type="submit">Pay ${esc(money(booking.amount, booking.currency))}</button></div>
      <p class="form__status js-status" role="status" aria-live="polite"></p>
    </form>`;
  const form = qs('.js-pay-form', body), status = qs('.js-status', form), timer = qs('.js-timer', body);
  const card = form.elements.card_number;
  card.addEventListener('input', () => { card.value = card.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
  form.elements.exp.addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); e.target.value = d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d; });
  qsa('.js-fill', body).forEach((b) => b.addEventListener('click', () => { card.value = b.dataset.card; form.elements.exp.value = '12 / 30'; form.elements.cvc.value = '123'; card.focus(); }));
  const expires = Date.parse(booking.expires_at);
  const tickTimer = () => {
    const left = Math.max(0, expires - Date.now());
    timer.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left`;
    if (!left) { clearInterval(iv); status.textContent = 'The hold expired and the slot was released.'; }
  };
  const iv = setInterval(tickTimer, 1000); tickTimer();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const digits = card.value.replace(/\D/g, '');
    const errs = {
      card_number: digits.length < 13 ? 'Enter a card number (use a test card above)' : '',
      exp: !/^\d{2} \/ \d{2}$/.test(form.elements.exp.value) ? 'Use MM / YY' : '',
      cvc: !/^\d{3,4}$/.test(form.elements.cvc.value) ? '3 or 4 digits' : '',
    };
    Object.entries(errs).forEach(([k, m]) => setFieldError(form, k, m));
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) { form.elements[first].focus(); return; }
    const btn = qs('button[type="submit"]', form);
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); status.textContent = 'Processing…';
    try {
      await api(`/bookings/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { card_number: digits } });
      clearInterval(iv);
      ctx.router.navigate(`/book/done/${id}`);
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      if (err.status === 402) { setFieldError(form, 'card_number', err.decline_code === 'insufficient_funds' ? 'Declined: insufficient funds' : 'Card declined — try another card'); status.textContent = err.message || 'Your card was declined.'; card.focus(); }
      else if (err.status === 400) { setFieldError(form, 'card_number', err.message || 'Invalid card'); status.textContent = ''; card.focus(); }
      else if (err.status === 410) { clearInterval(iv); status.innerHTML = `${esc(err.message)} <a class="u-link" href="/book">Pick a new slot</a>`; }
      else status.textContent = err.message || 'Payment failed. Please try again.';
    }
  });
  return { destroy() { clearInterval(iv); } };
}

// ---------------------------------------------------------------- 04
async function mountDone(root, ctx) {
  document.title = 'Booking — Hussain Singapuri';
  const id = ctx.route.id;
  const sid = new URLSearchParams(location.search).get('session_id');
  root.innerHTML = shell(3, 'Confirmed', '', '<p class="loading">Confirming your booking</p>');
  const body = qs('.js-step', root);
  try {
    const get = () => api(`/bookings/${encodeURIComponent(id)}${sid ? `?session_id=${encodeURIComponent(sid)}` : ''}`).then((r) => r.data.booking);
    let booking = await get();
    for (let i = 0; i < 3 && sid && booking.status === 'held'; i++) { await new Promise((r) => setTimeout(r, 1500)); booking = await get(); }
    if (sid) history.replaceState({}, '', `/book/done/${id}`);
    if (booking.status === 'held') {
      body.innerHTML = `<p class="form__status" role="status">Waiting for payment.</p>${booking.pay_url ? `<a class="btn" href="${esc(booking.pay_url)}">Complete payment</a>` : ''}`;
      return { destroy() {} };
    }
    if (booking.status !== 'confirmed') {
      qs('#book-title', root).textContent = booking.status === 'cancelled' ? 'Cancelled' : 'Expired';
      body.innerHTML = `<p class="form__status" role="status">This booking is ${esc(booking.status)}${booking.status === 'expired' ? ': the hold ran out before payment, so the slot was released' : ''}.</p><a class="btn" href="/book">Pick a new time</a>`;
      return { destroy() {} };
    }
    body.innerHTML = `<div class="success-panel" style="padding:0" tabindex="-1" role="status">
      <span class="success-panel__big">See you then</span>
      <dl class="summary"><dt>Call</dt><dd>${esc(booking.service.name)}</dd><dt>When</dt><dd>${esc(fmtSlot(booking.slot))}</dd>${booking.amount ? `<dt>Paid</dt><dd>${esc(money(booking.amount, booking.currency))}</dd>` : ''}<dt>Reference</dt><dd>${esc(booking.id)}</dd></dl>
      <p>A calendar invite is on its way to your inbox. The video link follows the day before.</p>
      <div class="form__foot"><a class="btn btn--ghost" href="/">Back to the homepage</a><a class="btn" href="/#work">See the work</a></div></div>`;
    qs('.success-panel', body).focus();
  } catch (err) {
    body.innerHTML = `<p class="form__status" role="alert">${esc(err.status === 404 ? 'We could not find that booking.' : err.message)}</p><a class="btn" href="/book">Book a call</a>`;
  }
  return { destroy() {} };
}

export function mount(root, ctx) {
  const n = ctx.route.name;
  if (n === 'pay') return mountPay(root, ctx);
  if (n === 'done') return mountDone(root, ctx);
  return mountBook(root, ctx);
}
