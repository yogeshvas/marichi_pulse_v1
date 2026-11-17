import { api, session } from '../api.js';
import { html, raw, mount, money, hhmm, dayLabel, dur, starsText, field, setPlace, placeValue, showErrors, setBusy, plusDays, today, nightsBetween } from '../ui.js';

const CITY = { LUN: 'Lusaka', NLA: 'Ndola', LVI: 'Livingstone', MFU: 'Mfuwe', SLI: 'Solwezi', KMZ: 'Kasama', CIP: 'Chipata', MNR: 'Mongu', VFA: 'Victoria Falls', HRE: 'Harare', JNB: 'Johannesburg', CPT: 'Cape Town', NBO: 'Nairobi', ADD: 'Addis Ababa', DAR: 'Dar es Salaam', LLW: 'Lilongwe', WDH: 'Windhoek', DXB: 'Dubai', DOH: 'Doha', LHR: 'London', JFK: 'New York', DEL: 'Delhi', BOM: 'Mumbai' };

export async function planner({ query, app }) {
  document.title = 'Trip planner · Marichi Pulse';
  const q = { origin: query.origin || 'LUN', destination: query.destination || 'LVI', date: query.date || plusDays(21), nights: query.nights || '3', adults: query.adults || '2', budget: query.budget || '' };
  mount(app, html`<div class="rhead"><div><h1>Trip planner</h1><p class="muted">Tell us the basics. We build flight and hotel packages you can book in a few clicks.</p></div></div>
    <form class="card stack" id="f" novalidate>
      <div class="grid g2">${field('From', 'origin', { ac: 'any', placeholder: 'City or airport' })}${field('To', 'destination', { ac: 'city', placeholder: 'City' })}</div>
      <div class="grid g4">${field('Leaving', 'date', { type: 'date', value: q.date, attrs: `min="${today()}"` })}
        <label class="field"><span>Nights</span><select name="nights">${[1, 2, 3, 4, 5, 6, 7, 10, 14].map((n) => html`<option value="${n}" ${String(n) === String(q.nights) ? raw('selected') : ''}>${n}</option>`)}</select></label>
        <label class="field"><span>Travellers</span><select name="adults">${[1, 2, 3, 4, 5, 6].map((n) => html`<option value="${n}" ${String(n) === String(q.adults) ? raw('selected') : ''}>${n}</option>`)}</select></label>
        ${field('Total budget (optional)', 'budget', { type: 'number', value: q.budget, attrs: 'min="500" step="500"', required: false, placeholder: 'e.g. 15000' })}</div>
      <div class="row"><span class="muted small">Flights and rooms are live offers, so prices are real.</span><button class="btn" type="submit">Build my packages</button></div></form>
    <div id="out" style="margin-top:18px"></div>`);
  const f = app.querySelector('#f');
  setPlace(f.elements.origin, q.origin, CITY[q.origin] || q.origin);
  setPlace(f.elements.destination, q.destination, CITY[q.destination] || q.destination);

  const run = async () => {
    const e = {};
    const origin = placeValue(f.elements.origin), destination = placeValue(f.elements.destination);
    if (!origin) e.origin = 'Choose a place from the list'; if (!destination) e.destination = 'Choose a place from the list';
    if (origin && origin === destination) e.destination = 'Pick a different place';
    if (showErrors(f, e)) return;
    const btn = f.querySelector('[type=submit]'); setBusy(btn, true, 'Planning…');
    const out = app.querySelector('#out');
    mount(out, html`<div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>`);
    try {
      const r = await api('/ai/plan', { method: 'POST', body: { origin, destination, date: f.elements.date.value, nights: Number(f.elements.nights.value), adults: Number(f.elements.adults.value), ...(f.elements.budget.value ? { budget: Number(f.elements.budget.value) } : {}) } });
      draw(out, r);
    } catch (err) { mount(out, html`<div class="card empty"><h3>We could not build packages</h3><p class="muted">${err.message}</p></div>`); }
    setBusy(btn, false);
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  if (query.destination && query.date) run();
}

function draw(out, r) {
  const q = r.query;
  if (!r.options.length) return mount(out, html`<div class="card empty"><h3>No packages found</h3><p class="muted">${r.note || 'Try other dates.'}</p></div>`);
  const nights = nightsBetween(q.date, q.checkOut);
  mount(out, html`<div class="stack"><h2>${CITY[q.destination] || q.destination} · ${dayLabel(q.date)} to ${dayLabel(q.checkOut)} · ${q.adults} traveller${q.adults > 1 ? 's' : ''}</h2>
    ${q.budget && !r.options.some((o) => o.fitsBudget) ? html`<div class="alert warn">Nothing fits ${money(q.budget)} for these dates. The closest option is ${money(Math.min(...r.options.map((o) => o.total)))}. Try fewer nights or other dates.</div>` : ''}
    ${r.options.map((o, i) => html`<article class="card pkg ${i === 0 ? 'best' : ''}">
      <div class="row"><div><h3>${o.label}</h3><span class="small muted">${o.why}</span></div>
        <div style="text-align:right"><div class="price num">${money(o.total)}</div><div class="small muted">flight and ${nights} night${nights > 1 ? 's' : ''}</div>
          ${o.fitsBudget === true ? html`<span class="chip good">Within budget</span>` : o.fitsBudget === false ? html`<span class="chip warn">${money(o.overBy)} over budget</span>` : ''}</div></div>
      <div class="part"><div class="ico" aria-hidden="true">✈</div><div><strong>${o.flight.carrier} ${o.flight.number}</strong><div class="small muted">${hhmm(o.flight.departAt)} to ${hhmm(o.flight.arriveAt)} · ${dur(o.flight.durationMinutes)} · ${o.flight.stops ? `${o.flight.stops} stop` : 'Non-stop'} · return ${o.flight.returnDepartAt ? dayLabel(o.flight.returnDepartAt) : ''}</div></div><b class="num">${money(o.flight.total)}</b></div>
      <div class="part"><div class="ico" aria-hidden="true">🏨</div><div><strong>${o.hotel.name}</strong> <span class="stars">${starsText(o.hotel.stars)}</span><div class="small muted">${o.hotel.room} · ${o.hotel.board} · ${o.hotel.cancellation}${o.hotel.score ? ` · rated ${o.hotel.score}` : ''}</div></div><b class="num">${money(o.hotel.total)}</b></div>
      <div class="row"><span class="small muted">Book the flight first, then your hotel opens next.</span><button class="btn" data-book="${i}">Book this package</button></div></article>`)}</div>`);
  out.querySelectorAll('[data-book]').forEach((b) => b.addEventListener('click', () => {
    const o = r.options[Number(b.dataset.book)];
    try { sessionStorage.setItem('pulse.bundle', JSON.stringify({ flightId: o.flight.id, hotelOffer: o.hotel.offerId })); } catch { /* ignore */ }
    location.hash = `#/checkout/flight/${o.flight.id}`;
  }));
}
void session;
