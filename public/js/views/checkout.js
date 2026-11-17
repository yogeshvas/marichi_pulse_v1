import { api, ApiError, session } from '../api.js';
import { html, raw, mount, money, hhmm, dayLabel, dur, stopsLabel, cabinLabel, starsText, nightsBetween, field, showErrors, setBusy, toast } from '../ui.js';
import { memory } from './search.js';
import { requireLogin } from '../auth.js';
import { showRewards, rewardsBox, bindRewards } from './rewards.js';
import { loadAgentContext, agentPanel, bindAgentPanel, readAgent } from './agentbooking.js';

const YEAR = new Date().getFullYear();
const NETWORKS = [['mtn', 'MTN Mobile Money'], ['airtel', 'Airtel Money'], ['zamtel', 'Zamtel Kwacha']];
const cardInputs = (prefix = 'card') => html`
  <div class="stack">
    <div class="grid g2">${field('Card number', `${prefix}.number`, { placeholder: '1234 5678 9012 3456', attrs: 'inputmode="numeric" autocomplete="cc-number"' })}
      ${field('Name on card', `${prefix}.holder`, { attrs: 'autocomplete="cc-name"' })}</div>
    <div class="grid g3">
      <label class="field"><span>Expiry month</span><select name="${prefix}.expMonth" autocomplete="cc-exp-month">${Array.from({ length: 12 }, (_, i) => html`<option value="${i + 1}">${String(i + 1).padStart(2, '0')}</option>`)}</select></label>
      <label class="field"><span>Expiry year</span><select name="${prefix}.expYear" autocomplete="cc-exp-year">${Array.from({ length: 12 }, (_, i) => html`<option value="${YEAR + i}" ${i === 3 ? raw('selected') : ''}>${YEAR + i}</option>`)}</select></label>
      ${field('CVV', `${prefix}.cvv`, { attrs: 'inputmode="numeric" maxlength="4" autocomplete="cc-csc"' })}</div>
  </div>`;

/** Mobile money first, because most Zambians pay that way. Card is one tap away. */
const paymentFields = () => html`<div class="stack" id="payfields">
  <div class="seg" role="radiogroup" aria-label="Payment method"><label><input type="radio" name="pay.method" value="momo" checked><span>Mobile money</span></label><label><input type="radio" name="pay.method" value="card"><span>Card</span></label></div>
  <div id="momobox" class="stack"><div class="grid g2">
    <label class="field"><span>Network</span><select name="momo.network">${NETWORKS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
    ${field('Mobile number', 'momo.phone', { placeholder: '097 123 4567', attrs: 'inputmode="tel" autocomplete="tel-national"' })}</div>
    <p class="small muted">You will get a prompt on your phone. Enter your PIN to approve the payment.</p></div>
  <div id="cardsbox" class="stack" hidden>${cardInputs()}</div>
  <p class="small muted">Demo: any valid Zambian number works (a number ending 0000 is declined). Test card 4111 1111 1111 1111.</p></div>`;

export function bindPayment(root) {
  const boxes = () => { const m = root.querySelector('[name="pay.method"]:checked')?.value; root.querySelector('#momobox').hidden = m !== 'momo'; root.querySelector('#cardsbox').hidden = m !== 'card'; };
  root.querySelectorAll('[name="pay.method"]').forEach((r) => r.addEventListener('change', boxes));
  boxes();
}

const readPayment = (form) => {
  const f = form.elements;
  if (form.querySelector('[name="pay.method"]:checked').value === 'momo') return { momo: { network: f['momo.network'].value, phone: f['momo.phone'].value.trim() } };
  return { card: { number: f['card.number'].value, holder: f['card.holder'].value.trim(), expMonth: Number(f['card.expMonth'].value), expYear: Number(f['card.expYear'].value), cvv: f['card.cvv'].value } };
};

const stepper = (names, cur) => html`<div class="steps" aria-label="Progress">${names.map((n, i) => html`<span class="${i === cur ? 'on' : i < cur ? 'done' : ''}">${i + 1}. ${n}</span>`)}</div>`;
const gone = (app, e, back) => mount(app, html`<div class="card empty"><h2>${e.code === 'OFFER_EXPIRED' || e.code === 'OFFER_GONE' ? 'This offer is no longer available' : 'We could not open checkout'}</h2><p class="muted">${e.message}</p><a class="btn" href="${back}">Search again</a></div>`);

/* ============================== FLIGHT CHECKOUT ============================== */
export async function flightCheckout({ params, app }) {
  const id = params[0];
  document.title = 'Checkout · Marichi Pulse';
  mount(app, html`<div class="skeleton"></div>`);
  let offer, caps;
  try { offer = await api(`/flights/offers/${id}/price`, { method: 'POST' }); caps = offer.capabilities; } catch (e) { return gone(app, e, '#/'); }

  const adults = Math.max(1, Math.round(offer.price.total / offer.price.perAdult));
  const agentCtx = await loadAgentContext();
  const saved = session.get() ? await api('/account/travellers').then((r) => r.travellers).catch(() => []) : [];
  const c = {
    step: 0, offer, adults, seatmaps: null, seatPurchase: caps?.seatPurchase, seats: [], activeSeg: 0, activeTraveler: 0,
    travelers: Array.from({ length: adults }, () => ({ firstName: '', lastName: '', dob: '', gender: 'M', passport: null })),
    contact: { email: session.get()?.user.email || '', countryCode: '+260', phone: '' }, acceptPrice: false,
  };
  const STEPS = ['Review', 'Seats', 'Travellers', 'Payment'];
  const seatFee = () => (c.seatPurchase ? c.seats.reduce((s, x) => s + x.price, 0) : 0);
  const total = () => c.offer.price.total + seatFee();
  const cur = c.offer.price.currency;

  const side = () => html`<aside class="side"><div class="card sum">
    <h3>Price summary</h3>
    <div><span>Fare × ${adults}</span><span class="num">${money(c.offer.price.total, cur)}</span></div>
    ${c.seats.length ? html`<div><span>Seats (${c.seats.length})</span><span class="num">${c.seatPurchase ? money(seatFee(), cur) : 'Requested'}</span></div>` : ''}
    <div id="side-disc" hidden></div>
    <div class="tot"><span>Total</span><span class="num" id="side-total">${money(total(), cur)}</span></div>
    <p class="small muted">${cabinLabel(c.offer.cabin)} · ${c.offer.checkedBags} checked baggage</p></div></aside>`;

  const itinerary = () => c.offer.itineraries.map((it, i) => {
    const a = it.segments[0], z = it.segments.at(-1);
    return html`<div class="card"><div class="row"><strong>${c.offer.itineraries.length > 1 ? (i ? 'Return' : 'Outbound') : 'Flight'} · ${dayLabel(a.departAt)}</strong><span class="chip plain">${dur(it.durationMinutes)} · ${stopsLabel(it)}</span></div>
      <div class="stack" style="margin-top:12px">${it.segments.map((s) => html`<div class="times"><div><div class="t num">${hhmm(s.departAt)}</div><div class="iata">${s.from}${s.terminalFrom ? ` · T${s.terminalFrom}` : ''}</div></div>
        <div class="path">${s.carrierName} ${s.number}<i></i>${s.aircraft}</div><div style="text-align:right"><div class="t num">${hhmm(s.arriveAt)}</div><div class="iata">${s.to}</div></div></div>`)}</div>
      <p class="small muted" style="margin-top:10px">${a.from} to ${z.to}</p></div>`;
  });

  const render = () => {
    const body = [renderReview, renderSeats, renderTravellers, renderPayment][c.step]();
    mount(app, html`<h1 style="margin-bottom:12px">Complete your booking</h1>${stepper(STEPS, c.step)}<div class="co"><div class="stack" id="main">${body}</div>${side()}</div>`);
    bind();
  };

  const renderReview = () => html`
    ${c.offer.priceChanged ? html`<div class="alert warn">The fare changed from ${money(c.offer.previousTotal, cur)} to ${money(c.offer.price.total, cur)} while you were browsing. The new price is shown below.</div>` : html`<div class="alert good">Fare confirmed with the airline.</div>`}
    ${itinerary()}
    <div class="row"><a class="btn ghost" href="#/flights?${new URLSearchParams(memory.flightQuery || {})}">Back to results</a><button class="btn" data-next>Continue</button></div>`;

  const renderSeats = () => {
    if (!c.seatmaps) return html`<div class="skeleton"></div>`;
    if (!c.seatmaps.length) return html`<div class="card stack"><h2>Seats</h2><p class="muted">Seat selection is not available for this fare. The airline assigns seats at check-in.</p>
      <div class="row"><button class="btn ghost" data-prev>Back</button><button class="btn" data-next>Continue</button></div></div>`;
    const m = c.seatmaps[c.activeSeg];
    const mineHere = (n) => c.seats.find((s) => s.segmentId === m.segmentId && s.number === n);
    return html`<div class="card stack"><div class="row"><h2>Choose seats</h2><button class="link" data-next data-skip>Skip, assign at check-in</button></div>
      <p class="muted small">${c.seatPurchase ? 'Seat fees are added to your total.' : 'Seat choices are sent as a request. The airline confirms them at check-in.'}</p>
      ${c.seatmaps.length > 1 ? html`<div class="pick" role="group" aria-label="Flight segment">${c.seatmaps.map((x, i) => html`<button data-seg="${i}" aria-pressed="${i === c.activeSeg}">${x.label}</button>`)}</div>` : html`<p><strong>${m.label}</strong></p>`}
      <div class="pick" role="group" aria-label="Traveller">${c.travelers.map((t, i) => {
        const s = c.seats.find((x) => x.segmentId === m.segmentId && x.travelerIndex === i);
        return html`<button data-who="${i}" aria-pressed="${i === c.activeTraveler}">Traveller ${i + 1}${s ? ` · ${s.number}` : ''}</button>`;
      })}</div>
      <div class="key"><span><i></i>Standard</span><span><i class="l"></i>Extra legroom</span><span><i class="m"></i>Yours</span><span><i class="x"></i>Taken</span></div>
      <div class="cabin" role="group" aria-label="Seat map">${m.rows.map((r) => html`<div class="srow"><span class="n">${r.row}</span>${m.columns.map((col) => {
        if (col === '_') return html`<span class="gap"></span>`;
        const cell = r.cells[col];
        if (!cell) return html`<span style="width:30px"></span>`;
        const mine = mineHere(cell.number);
        const cls = !cell.available ? 'taken' : mine ? (mine.travelerIndex === c.activeTraveler ? 'mine' : 'other') : cell.extraLegroom ? 'legroom' : '';
        const label = mine ? `T${mine.travelerIndex + 1}` : col;
        return html`<button class="seat ${cls}" data-seat="${cell.number}" ${cell.available ? '' : raw('disabled')} aria-label="Seat ${cell.number}${cell.price && c.seatPurchase ? `, ${money(cell.price, cur)}` : ''}${cell.available ? '' : ', taken'}">${cell.available ? label : ''}</button>`;
      })}</div>`)}</div>
      <div class="row"><button class="btn ghost" data-prev>Back</button><button class="btn" data-next>Continue</button></div></div>`;
  };

  const renderTravellers = () => html`<form class="stack" id="travellers" novalidate>
    <div class="alert info">Enter names exactly as they appear on the passport or government ID.</div>
    ${c.travelers.map((t, i) => html`<div class="pass"><div class="row"><strong>Traveller ${i + 1}</strong>
      ${saved.length ? html`<select data-saved="${i}" aria-label="Use a saved traveller" style="max-width:220px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--surface)"><option value="">Use saved traveller…</option>${saved.map((x) => html`<option value="${x.id}">${x.firstName} ${x.lastName}</option>`)}</select>` : ''}</div>
      <div class="grid g2">${field('First name', `travelers.${i}.firstName`, { value: t.firstName, attrs: 'autocomplete="given-name"' })}${field('Last name', `travelers.${i}.lastName`, { value: t.lastName, attrs: 'autocomplete="family-name"' })}</div>
      <div class="grid g2">${field('Date of birth', `travelers.${i}.dob`, { type: 'date', value: t.dob, attrs: 'max="' + new Date().toISOString().slice(0, 10) + '"' })}
        <label class="field"><span>Gender</span><select name="travelers.${i}.gender"><option value="M" ${t.gender === 'M' ? raw('selected') : ''}>Male</option><option value="F" ${t.gender === 'F' ? raw('selected') : ''}>Female</option></select></label></div>
      <details ${t.passport ? raw('open') : ''}><summary class="link">Passport details (needed for international trips)</summary>
        <div class="grid g3" style="margin-top:10px">${field('Passport number', `travelers.${i}.passport.number`, { value: t.passport?.number || '', required: false })}
          ${field('Expiry', `travelers.${i}.passport.expiry`, { type: 'date', value: t.passport?.expiry || '', required: false })}${field('Issuing country', `travelers.${i}.passport.country`, { value: t.passport?.country || '', placeholder: 'ZM', required: false, attrs: 'maxlength="3"' })}</div></details></div>`)}
    <div class="pass"><strong>Contact for tickets and updates</strong>
      <div class="grid g3">${field('Email', 'contact.email', { type: 'email', value: c.contact.email, attrs: 'autocomplete="email"' })}${field('Country code', 'contact.countryCode', { value: c.contact.countryCode })}${field('Mobile number', 'contact.phone', { value: c.contact.phone, attrs: 'inputmode="tel" autocomplete="tel-national"' })}</div></div>
    <div class="row"><button type="button" class="btn ghost" data-prev>Back</button><button class="btn" type="submit">Continue to payment</button></div></form>`;

  const renderPayment = () => html`<form class="stack" id="pay" novalidate>
    <div class="card stack"><h2>Payment</h2>
      ${c.error ? html`<div class="alert" role="alert">${c.error}</div>` : ''}
      ${c.priceAlert ? html`<div class="alert warn" role="alert">The fare changed from ${money(c.priceAlert.oldTotal, cur)} to ${money(c.priceAlert.newTotal, cur)}. Press Pay to accept the new price.</div>` : ''}
      ${agentPanel(agentCtx, c.priceAlert?.newTotal ?? total(), cur)}
      ${agentCtx ? '' : rewardsBox()}
      <div id="cardbox">${paymentFields()}</div></div>
    <div class="row"><button type="button" class="btn ghost" data-prev>Back</button><button class="btn" type="submit">${agentCtx ? 'Book now' : html`<span id="paylabel">Pay ${money(c.quote ? c.quote.payable : (c.priceAlert?.newTotal ?? total()), cur)}</span>`}</button></div></form>`;

  const collectTravellers = (form) => {
    const f = form.elements;
    c.travelers = c.travelers.map((_, i) => {
      const p = { number: f[`travelers.${i}.passport.number`].value.trim(), expiry: f[`travelers.${i}.passport.expiry`].value, country: f[`travelers.${i}.passport.country`].value.trim() };
      return { firstName: f[`travelers.${i}.firstName`].value.trim(), lastName: f[`travelers.${i}.lastName`].value.trim(), dob: f[`travelers.${i}.dob`].value, gender: f[`travelers.${i}.gender`].value, passport: p.number || p.expiry || p.country ? p : null };
    });
    c.contact = { email: f['contact.email'].value.trim(), countryCode: f['contact.countryCode'].value.trim(), phone: f['contact.phone'].value.replace(/\D/g, '') };
  };

  const go = async (n) => {
    c.step = n; c.error = null; render();
    if (n === 1 && !c.seatmaps) {
      try { const r = await api(`/flights/offers/${id}/seatmap`); c.seatmaps = r.seatmaps; c.seatPurchase = r.seatPurchase; } catch { c.seatmaps = []; }
      if (c.step === 1) render();
    }
  };

  function bind() {
    app.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.skip) c.seats = []; go(c.step + 1); }));
    app.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => go(c.step - 1)));
    app.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { c.activeSeg = Number(b.dataset.seg); render(); }));
    app.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => { c.activeTraveler = Number(b.dataset.who); render(); }));
    app.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => {
      const m = c.seatmaps[c.activeSeg];
      const cell = m.rows.flatMap((r) => Object.values(r.cells)).find((x) => x.number === b.dataset.seat);
      const owner = c.seats.find((s) => s.segmentId === m.segmentId && s.number === cell.number);
      c.seats = c.seats.filter((s) => !(s.segmentId === m.segmentId && (s.travelerIndex === c.activeTraveler || s === owner)));
      if (!owner || owner.travelerIndex !== c.activeTraveler) c.seats.push({ segmentId: m.segmentId, travelerIndex: c.activeTraveler, number: cell.number, price: cell.price });
      if (c.activeTraveler < adults - 1 && (!owner || owner.travelerIndex !== c.activeTraveler)) c.activeTraveler += 1;
      render();
    }));

    app.querySelectorAll('[data-saved]').forEach((sel) => sel.addEventListener('change', () => {
      const x = saved.find((v) => String(v.id) === sel.value); if (!x) return;
      collectTravellers(app.querySelector('#travellers'));
      c.travelers[Number(sel.dataset.saved)] = { firstName: x.firstName, lastName: x.lastName, dob: x.dob, gender: x.gender, passport: x.passport || null };
      render();
    }));
    const tf = app.querySelector('#travellers');
    tf?.addEventListener('submit', (e) => {
      e.preventDefault(); collectTravellers(tf);
      const errs = {};
      c.travelers.forEach((t, i) => { if (!t.firstName) errs[`travelers.${i}.firstName`] = 'Required'; if (!t.lastName) errs[`travelers.${i}.lastName`] = 'Required'; if (!t.dob) errs[`travelers.${i}.dob`] = 'Required'; });
      if (!/^\S+@\S+\.\S+$/.test(c.contact.email)) errs['contact.email'] = 'Enter a valid email';
      if (!/^\d{6,14}$/.test(c.contact.phone)) errs['contact.phone'] = 'Digits only, 6 to 14';
      if (!/^\+\d{1,3}$/.test(c.contact.countryCode)) errs['contact.countryCode'] = 'Like +91';
      if (showErrors(tf, errs)) return;
      go(3);
    });
    tf?.querySelector('[data-prev]').addEventListener('click', () => collectTravellers(tf));

    const pf = app.querySelector('#pay');
    if (pf) { bindPayment(pf); bindAgentPanel(pf, agentCtx, c.priceAlert?.newTotal ?? total(), cur); }
    if (pf && !agentCtx) {
      c.rewards = bindRewards(pf, { kind: 'flight', offerId: id, extra: seatFee, onChange: (q) => {
        c.quote = q;
        const lab = pf.querySelector('#paylabel'); if (lab) lab.textContent = `Pay ${money(q.payable, cur)}`;
        const sd = app.querySelector('#side-disc'); if (sd) { sd.hidden = !q.discount; sd.innerHTML = q.discount ? `<span>Discounts</span><span class="num pos">−${money(q.discount)}</span>` : ''; }
        const st = app.querySelector('#side-total'); if (st) st.textContent = money(q.payable, cur);
      } });
    }
    pf?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = pf.querySelector('[type=submit]');
      const ag = agentCtx ? readAgent(pf, agentCtx) : null;
      if (ag && showErrors(pf, ag.errors)) return;
      const useCard = !agentCtx || agentCtx.opts.paymentMode === 'card';
      if (!(await requireLogin())) return;
      setBusy(btn, true, 'Booking…');
      try {
        const booking = await api('/bookings/flights', { method: 'POST', body: {
          offerId: id, travelers: c.travelers.map((t) => ({ ...t, passport: t.passport || undefined })), contact: c.contact,
          seats: c.seats.map(({ segmentId, travelerIndex, number }) => ({ segmentId, travelerIndex, number })),
          ...(useCard ? readPayment(pf) : {}), acceptPrice: Boolean(c.priceAlert), ...(ag ? { agent: ag.body } : {}),
          ...(c.rewards && !ag ? { promoCode: c.rewards.promoCode || undefined, usePoints: c.rewards.usePoints } : {}),
        } });
        let next = `#/trips/${booking.ref}?new=1`;
        try {
          const bundle = JSON.parse(sessionStorage.getItem('pulse.bundle') || 'null');
          if (bundle && bundle.flightId === id) { sessionStorage.removeItem('pulse.bundle'); next = `#/checkout/hotel/${encodeURIComponent(bundle.hotelOffer)}?bundle=${booking.ref}`; }
        } catch { /* ignore */ }
        location.hash = next;
      } catch (err) {
        setBusy(btn, false);
        if (err.code === 'PRICE_CHANGED') { c.priceAlert = err.details; c.offer.price.total = err.details.newTotal - seatFee(); c.error = null; return render(); }
        if (err.fields) {
          const mapped = {}; for (const [k, v] of Object.entries(err.fields)) mapped[k] = v;
          if (showErrors(pf, mapped)) return;
          const back = Object.keys(err.fields).some((k) => k.startsWith('travelers') || k.startsWith('contact'));
          c.error = back ? 'Some traveller details need fixing. Go back to correct them.' : err.message; return render();
        }
        if (err.code === 'SEAT_TAKEN') { c.seats = []; c.seatmaps = null; c.error = `${err.message} Your seat choices were cleared.`; return render(); }
        c.error = err.message; render();
      }
    });
  }
  render();
}

/* ============================== HOTEL CHECKOUT ============================== */
export async function hotelCheckout({ params, query: pageQuery = {}, app }) {
  const id = decodeURIComponent(params[0]);
  document.title = 'Checkout · Marichi Pulse';
  mount(app, html`<div class="skeleton"></div>`);
  let r;
  try { r = await api(`/hotels/offers/${encodeURIComponent(id)}`); } catch (e) { return gone(app, e, '#/?tab=hotels'); }
  const { hotel, offer, query } = r;
  const agentCtx = await loadAgentContext();
  const nights = nightsBetween(query.checkIn, query.checkOut);
  const user = session.get()?.user;
  const [first = '', ...rest] = (user?.name || '').split(' ');
  const state = { priceAlert: null, error: null, total: offer.price.total };
  const cur = offer.price.currency;

  const draw = () => {
    mount(app, html`
      <h1 style="margin-bottom:12px">Reserve your room</h1>
      ${pageQuery.bundle ? html`<div class="alert good" style="margin-bottom:12px">Flight booked (${pageQuery.bundle}). One more step: your hotel from the package.</div>` : ''}
      <div class="co"><div class="stack">
        ${r.priceChanged ? html`<div class="alert warn">The room price changed from ${money(r.previousTotal, cur)} to ${money(offer.price.total, cur)}. The new price is shown.</div>` : ''}
        <form class="stack" id="book" novalidate>
          <div class="card stack"><h2>Lead guest</h2><p class="muted small">The hotel checks this name at the front desk.</p>
            <div class="grid g2"><label class="field"><span>Title</span><select name="guest.title"><option>MR</option><option>MRS</option><option>MS</option></select></label><span></span></div>
            <div class="grid g2">${field('First name', 'guest.firstName', { value: first })}${field('Last name', 'guest.lastName', { value: rest.join(' ') })}</div>
            <div class="grid g2">${field('Email', 'guest.email', { type: 'email', value: user?.email || '' })}${field('Phone with country code', 'guest.phone', { value: '+260', placeholder: '+260971234567', attrs: 'inputmode="tel"' })}</div></div>
          <div class="card stack"><h2>Payment</h2>
            ${state.error ? html`<div class="alert" role="alert">${state.error}</div>` : ''}
            ${state.priceAlert ? html`<div class="alert warn" role="alert">The price changed from ${money(state.priceAlert.oldTotal, cur)} to ${money(state.priceAlert.newTotal, cur)}. Press Pay to accept it.</div>` : ''}
            ${agentPanel(agentCtx, state.priceAlert?.newTotal ?? state.total, cur)}
            ${agentCtx ? '' : rewardsBox()}
            <div id="cardbox">${paymentFields()}</div></div>
          <div class="row"><a class="btn ghost" href="#/hotels?${new URLSearchParams({ ...query, cityName: query.cityCode })}">Back to hotels</a><button class="btn" type="submit">${agentCtx ? 'Book now' : html`<span id="paylabel">Pay ${money(state.quote ? state.quote.payable : (state.priceAlert?.newTotal ?? state.total), cur)}</span>`}</button></div>
        </form></div>
        <aside class="side"><div class="card stack"><div><h3>${hotel.name}</h3><div class="small muted"><span class="stars">${starsText(hotel.stars)}</span> ${hotel.address || ''}</div></div>
          <div class="kv"><div><small>Check in</small>${dayLabel(query.checkIn)}</div><div><small>Check out</small>${dayLabel(query.checkOut)}</div></div>
          <div><strong>${offer.room.type}</strong><div class="small muted">${offer.room.bed} · ${offer.board} · ${query.rooms} room${query.rooms > 1 ? 's' : ''}, ${query.adults} guest${query.adults > 1 ? 's' : ''}</div></div>
          <span class="chip ${offer.cancellation.refundable ? 'good' : 'plain'}" style="justify-self:start">${offer.cancellation.text}</span></div>
          <div class="card sum"><h3>Price summary</h3>
            <div><span>${money(offer.price.perNight, cur)} × ${nights} night${nights > 1 ? 's' : ''}</span><span class="num">${money(offer.price.total - offer.price.taxes, cur)}</span></div>
            <div><span>Taxes and fees</span><span class="num">${money(offer.price.taxes, cur)}</span></div>
            <div id="side-disc" hidden></div>
            <div class="tot"><span>Total</span><span class="num" id="side-total">${money(offer.price.total, cur)}</span></div></div></aside></div>`);

    const form = app.querySelector('#book');
    bindPayment(form);
    bindAgentPanel(form, agentCtx, state.priceAlert?.newTotal ?? state.total, cur);
    if (!agentCtx) {
      state.rewards = bindRewards(form, { kind: 'hotel', offerId: id, onChange: (q) => {
        state.quote = q;
        const lab = form.querySelector('#paylabel'); if (lab) lab.textContent = `Pay ${money(q.payable, cur)}`;
        const sd = app.querySelector('#side-disc'); if (sd) { sd.hidden = !q.discount; sd.innerHTML = q.discount ? `<span>Discounts</span><span class="num pos">−${money(q.discount)}</span>` : ''; }
        const st = app.querySelector('#side-total'); if (st) st.textContent = money(q.payable, cur);
      } });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const btn = form.querySelector('[type=submit]');
      const ag = agentCtx ? readAgent(form, agentCtx) : null;
      if (ag && showErrors(form, ag.errors)) return;
      const useCard = !agentCtx || agentCtx.opts.paymentMode === 'card';
      if (!(await requireLogin())) return;
      setBusy(btn, true, 'Booking…');
      try {
        const b = await api('/bookings/hotels', { method: 'POST', body: {
          offerId: id, acceptPrice: Boolean(state.priceAlert), ...(useCard ? readPayment(form) : {}), ...(ag ? { agent: ag.body } : {}),
          ...(state.rewards && !ag ? { promoCode: state.rewards.promoCode || undefined, usePoints: state.rewards.usePoints } : {}),
          guest: { title: f['guest.title'].value, firstName: f['guest.firstName'].value.trim(), lastName: f['guest.lastName'].value.trim(), email: f['guest.email'].value.trim(), phone: f['guest.phone'].value.replace(/[\s-]/g, '') },
        } });
        location.hash = `#/trips/${b.ref}?new=1`;
      } catch (err) {
        setBusy(btn, false);
        if (err.code === 'PRICE_CHANGED') { state.priceAlert = err.details; return draw(); }
        if (err.fields && showErrors(form, err.fields)) return;
        state.error = err.message; draw();
      }
    });
  };
  draw();
}
void toast; void cabinLabel;
