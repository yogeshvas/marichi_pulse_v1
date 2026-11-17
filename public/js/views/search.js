import { api, session } from '../api.js';
import { html, raw, mount, money, hhmm, dayLabel, dur, stopsLabel, cabinLabel, starsText, nightsBetween, plusDays, today, field, setPlace, placeValue, showErrors, toast, longDate } from '../ui.js';

export const memory = { flightQuery: null, hotelOffer: null };

const POPULAR_FLIGHTS = [['LUN', 'Lusaka', 'LVI', 'Livingstone'], ['LUN', 'Lusaka', 'NLA', 'Ndola'], ['LUN', 'Lusaka', 'MFU', 'Mfuwe'], ['LUN', 'Lusaka', 'JNB', 'Johannesburg'], ['LUN', 'Lusaka', 'NBO', 'Nairobi'], ['NLA', 'Ndola', 'LUN', 'Lusaka']];
const POPULAR_CITIES = [['LVI', 'Livingstone'], ['LUN', 'Lusaka'], ['MFU', 'South Luangwa'], ['NLA', 'Copperbelt'], ['VFA', 'Victoria Falls'], ['CPT', 'Cape Town']];

/* ============================== HOME ============================== */
export function home({ query, app }) {
  const tab = query.tab === 'hotels' ? 'hotels' : 'flights';
  document.title = 'Marichi Pulse: flights and hotels';
  mount(app, html`
    <section class="hero2">
      <img class="heromark" src="/img/mark.jpg" alt="" aria-hidden="true">
      <span class="eyebrow">${tab === 'flights' ? '✈ Flights' : '🏨 Hotels'} · by Marichi Labs</span>
      <h1>${tab === 'flights' ? raw('Find the flight that <em>fits your day</em>') : raw('Find a place that <em>feels right</em>')}</h1>
      <p>${tab === 'flights' ? 'Compare fares from Zambian and international airlines, flex your dates, pick your seat and pay in Kwacha or with mobile money.' : 'From city hotels to safari lodges. Compare rooms with clear cancellation terms and pay with mobile money.'}</p>
      <p class="small" style="margin:0"><a href="#/planner" style="font-weight:600">✦ Plan flight and hotel together</a> <span class="muted">or just tell the assistant where you want to go.</span></p>
    </section>
    <section class="card searchbox">
      <div class="tabs" role="tablist">
        <a href="#/" class="${tab === 'flights' ? 'on' : ''}" role="tab" aria-selected="${tab === 'flights'}">Flights</a>
        <a href="#/?tab=hotels" class="${tab === 'hotels' ? 'on' : ''}" role="tab" aria-selected="${tab === 'hotels'}">Hotels</a>
      </div>
      ${tab === 'flights' ? flightForm() : hotelForm()}
    </section>
    <section class="stack" style="margin-top:22px">
      <h2>${tab === 'flights' ? 'Popular routes' : 'Popular destinations'}</h2>
      <div class="pops">${tab === 'flights'
        ? POPULAR_FLIGHTS.map(([a, an, b, bn]) => html`<button type="button" data-route="${a}|${an}|${b}|${bn}">${an} → ${bn}</button>`)
        : POPULAR_CITIES.map(([c, n]) => html`<button type="button" data-city="${c}|${n}">${n}</button>`)}</div>
    </section>
    <section class="stack" style="margin-top:26px" id="picks" hidden><h2>Picked for you</h2><div class="sugg" id="picklist"></div></section>
    <section class="stack" style="margin-top:26px" id="offers" hidden><h2>Offers for you</h2><div class="offers" id="offerlist"></div></section>
    <section class="perks" style="margin-top:28px">
      <div class="card"><h3>Pay your way</h3><p class="muted">Card, or mobile money with MTN, Airtel and Zamtel. Prices are in Zambian Kwacha.</p></div>
      <div class="card"><h3>Clear cancellation terms</h3><p class="muted">Every fare and room shows what you get back if plans change.</p></div>
      <div class="card"><h3>All trips in one place</h3><p class="muted">Tickets and hotel vouchers stay in My trips, ready to show.</p></div>
    </section>`);

  api('/ai/suggestions').then(({ suggestions }) => {
    if (!suggestions.length) return;
    app.querySelector('#picks').hidden = false;
    mount(app.querySelector('#picklist'), html`${suggestions.map((x) => html`<a href="${x.href}"><strong>${x.title}</strong><small>${x.subtitle}</small></a>`)}`);
  }).catch(() => {});
  api('/offers').then(({ offers }) => {
    if (!offers.length) return;
    app.querySelector('#offers').hidden = false;
    mount(app.querySelector('#offerlist'), html`${offers.map((o) => html`<div class="offer-card"><span class="chip" style="width:max-content">${o.applies_to === 'all' ? 'Flights and hotels' : o.applies_to === 'flight' ? 'Flights' : 'Hotels'}</span>
      <h3>${o.description}</h3><button type="button" class="code" data-copy="${o.code}" title="Click to copy">${o.code} <span aria-hidden="true">⧉</span></button>
      <span class="small muted">${o.min_total ? `Min spend ${money(o.min_total)}` : 'No minimum spend'}${o.expires_at ? ` · until ${o.expires_at}` : ''}</span></div>`)}`);
    app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast(`Code ${b.dataset.copy} copied. Apply it at checkout.`); } catch { toast(`Use code ${b.dataset.copy} at checkout`); } }));
  }).catch(() => {});

  const form = app.querySelector('form');
  if (tab === 'flights') { setPlace(form.elements.origin, 'LUN', 'Lusaka'); setPlace(form.elements.destination, 'LVI', 'Livingstone'); }
  else setPlace(form.elements.city, 'LVI', 'Livingstone');
  if (tab === 'flights') form.elements.returnDate.closest('.field').hidden = true;

  app.querySelectorAll('[name=tripType]').forEach((r) => r.addEventListener('change', () => {
    form.elements.returnDate.closest('.field').hidden = form.elements.tripType.value === 'oneway';
    form.elements.returnDate.required = form.elements.tripType.value === 'round';
  }));
  app.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    const [a, an, c, cn] = b.dataset.route.split('|');
    setPlace(form.elements.origin, a, an); setPlace(form.elements.destination, c, cn);
    form.querySelector('button[type=submit]').focus();
  }));
  app.querySelectorAll('[data-city]').forEach((b) => b.addEventListener('click', () => {
    const [c, n] = b.dataset.city.split('|');
    setPlace(form.elements.city, c, n);
    form.querySelector('button[type=submit]').focus();
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    if (tab === 'flights') {
      const errors = {};
      const origin = placeValue(f.origin), destination = placeValue(f.destination);
      if (!origin) errors.origin = 'Choose an airport from the list';
      if (!destination) errors.destination = 'Choose an airport from the list';
      if (origin && origin === destination) errors.destination = 'Pick a different airport';
      if (f.tripType.value === 'round' && f.returnDate.value < f.date.value) errors.returnDate = 'Return must be after departure';
      if (showErrors(form, errors)) return;
      const q = new URLSearchParams({ origin, destination, date: f.date.value, adults: f.adults.value, cabin: f.cabin.value });
      if (f.tripType.value === 'round') q.set('returnDate', f.returnDate.value);
      location.hash = `#/flights?${q}`;
    } else {
      const errors = {};
      const cityCode = placeValue(f.city);
      if (!cityCode) errors.city = 'Choose a city from the list';
      if (f.checkOut.value <= f.checkIn.value) errors.checkOut = 'Check out must be after check in';
      if (showErrors(form, errors)) return;
      location.hash = `#/hotels?${new URLSearchParams({ cityCode, cityName: f.city.value.replace(/\s*\(.*$/, ''), checkIn: f.checkIn.value, checkOut: f.checkOut.value, adults: f.adults.value, rooms: f.rooms.value })}`;
    }
  });
}

const opts = (arr, sel, label = (n) => n) => arr.map((n) => html`<option value="${n}" ${n == sel ? raw('selected') : ''}>${label(n)}</option>`);

function flightForm() {
  return html`<form novalidate>
    <div class="seg" role="radiogroup" aria-label="Trip type">
      <label><input type="radio" name="tripType" value="oneway" checked><span>One way</span></label>
      <label><input type="radio" name="tripType" value="round"><span>Round trip</span></label>
    </div>
    <div class="grid g2">${field('From', 'origin', { ac: 'any', placeholder: 'City or airport' })}${field('To', 'destination', { ac: 'any', placeholder: 'City or airport' })}</div>
    <div class="grid g4">
      ${field('Depart', 'date', { type: 'date', value: plusDays(14), attrs: `min="${today()}"` })}
      ${field('Return', 'returnDate', { type: 'date', value: plusDays(18), attrs: `min="${today()}"`, required: false })}
      <label class="field"><span>Travellers</span><select name="adults">${opts([1, 2, 3, 4, 5, 6], 1, (n) => `${n} adult${n > 1 ? 's' : ''}`)}</select></label>
      <label class="field"><span>Cabin</span><select name="cabin">${['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].map((c) => html`<option value="${c}">${cabinLabel(c)}</option>`)}</select></label>
    </div>
    <div class="row"><span class="muted small">Prices include taxes and fees.</span><button class="btn" type="submit">Search flights</button></div>
  </form>`;
}
function hotelForm() {
  return html`<form novalidate>
    <div class="grid g2">${field('Destination', 'city', { ac: 'city', placeholder: 'City' })}
      <label class="field"><span>Guests</span><select name="adults">${opts([1, 2, 3, 4, 5, 6], 2, (n) => `${n} guest${n > 1 ? 's' : ''}`)}</select></label></div>
    <div class="grid g3">
      ${field('Check in', 'checkIn', { type: 'date', value: plusDays(14), attrs: `min="${today()}"` })}
      ${field('Check out', 'checkOut', { type: 'date', value: plusDays(17), attrs: `min="${today()}"` })}
      <label class="field"><span>Rooms</span><select name="rooms">${opts([1, 2, 3, 4], 1, (n) => `${n} room${n > 1 ? 's' : ''}`)}</select></label>
    </div>
    <div class="row"><span class="muted small">Taxes are shown in the total.</span><button class="btn" type="submit">Search hotels</button></div>
  </form>`;
}

/* ============================== FLIGHT RESULTS ============================== */
const skeletons = html`<div class="stack">${[1, 2, 3, 4].map(() => html`<div class="skeleton"></div>`)}</div>`;
const errorBox = (e, back) => html`<div class="card empty"><h2>${e.status === 400 ? 'Check your search' : 'We could not load results'}</h2><p class="muted">${e.message}</p><a class="btn" href="${back}">Change search</a></div>`;
const band = (iso) => { const h = Number(hhmm(iso).slice(0, 2)); return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

export async function flightResults({ query, app }) {
  document.title = `${query.origin} to ${query.destination} · Marichi Pulse`;
  memory.flightQuery = query;
  mount(app, html`<div class="rhead"><div><h1>${query.origin} → ${query.destination}</h1><p class="muted">Searching airlines…</p></div></div>${skeletons}`);
  let data;
  try { data = await api('/flights/search', { query }); } catch (e) { return mount(app, errorBox(e, '#/')); }
  const offers = data.offers;
  const state = { sort: 'price', stops: 'any', airlines: new Set(), maxPrice: Math.max(...offers.map((o) => o.price.total), 0), times: new Set() };
  const carriers = [...new Set(offers.flatMap((o) => o.itineraries[0].segments.map((s) => s.carrierName)))].sort();
  const top = Math.max(...offers.map((o) => o.price.total), 0);
  const adults = Number(query.adults) || 1;
  const minPrice = Math.min(...offers.map((o) => o.price.total));
  const minDur = Math.min(...offers.map((o) => o.itineraries[0].durationMinutes));
  const score = (o) => o.price.total / minPrice + o.itineraries[0].durationMinutes / minDur + o.stops * 0.35;
  const bestId = [...offers].sort((a, b) => score(a) - score(b))[0]?.id;
  const flags = new Map(offers.map((o) => [o.id, { cheap: o.price.total === minPrice, fast: o.itineraries[0].durationMinutes === minDur, best: o.id === bestId }]));
  const isAgentUser = session.get()?.user.role === 'agent';

  const shell = html`
    <div class="rhead">
      <div><h1>${query.origin} → ${query.destination}</h1>
        <p class="muted">${longDate(query.date)}${query.returnDate ? ` · back ${dayLabel(query.returnDate)}` : ''} · ${adults} traveller${adults > 1 ? 's' : ''} · ${cabinLabel(query.cabin)}</p></div>
      <a class="btn ghost sm" href="#/">Change search</a>
    </div>
    <div class="layout">
      <aside class="card filters" aria-label="Filters">
        <fieldset><legend>Stops</legend>
          ${[['any', 'Any'], ['0', 'Non-stop only'], ['1', 'Up to 1 stop']].map(([v, l]) => html`<label><input type="radio" name="stops" value="${v}" ${v === 'any' ? raw('checked') : ''}> ${l}</label>`)}</fieldset>
        <fieldset><legend>Departure time</legend>
          ${[['morning', 'Morning 06 to 12'], ['afternoon', 'Afternoon 12 to 18'], ['evening', 'Evening 18 to 24'], ['night', 'Night 00 to 06']].map(([v, l]) => html`<label><input type="checkbox" name="time" value="${v}"> ${l}</label>`)}</fieldset>
        <fieldset><legend>Airlines</legend>${carriers.map((c) => html`<label><input type="checkbox" name="airline" value="${c}"> ${c}</label>`)}</fieldset>
        <fieldset><legend>Max price <span id="maxlabel" class="muted small num">${money(top)}</span></legend><input type="range" name="price" min="0" max="${Math.ceil(top)}" value="${Math.ceil(top)}" step="100" aria-label="Maximum price"></fieldset>
      </aside>
      <section class="stack">
        <div id="advice"></div>
        <div id="calendar" class="cal" aria-label="Fare calendar"></div>
        <div class="row"><span id="count" class="muted"></span>
          <div class="sorts" role="group" aria-label="Sort">${[['price', 'Cheapest'], ['duration', 'Fastest'], ['depart', 'Earliest']].map(([v, l]) => html`<button type="button" data-sort="${v}" aria-pressed="${v === 'price'}">${l}</button>`)}</div></div>
        <div id="list" class="stack"></div>
      </section>
    </div>`;
  mount(app, shell);
  const list = app.querySelector('#list');

  const draw = () => {
    let l = offers.filter((o) => (state.stops === 'any' || o.stops <= Number(state.stops))
      && (!state.airlines.size || o.itineraries[0].segments.some((s) => state.airlines.has(s.carrierName)))
      && (!state.times.size || state.times.has(band(o.itineraries[0].segments[0].departAt)))
      && o.price.total <= state.maxPrice);
    const key = { price: (o) => o.price.total, duration: (o) => o.itineraries[0].durationMinutes, depart: (o) => o.itineraries[0].segments[0].departAt }[state.sort];
    l = [...l].sort((a, b) => (key(a) > key(b) ? 1 : -1));
    app.querySelector('#count').textContent = `${l.length} of ${offers.length} flights`;
    mount(list, l.length ? html`${l.map((o) => offerCard(o, adults, flags.get(o.id), isAgentUser))}` : html`<div class="card empty"><h3>No flights match these filters</h3><p class="muted">Loosen a filter to see more.</p></div>`);
  };
  draw();

  // Buy-or-wait advice from the fare pattern.
  api('/ai/advice', { query: { origin: query.origin, destination: query.destination, date: query.date, adults, cabin: query.cabin } }).then((a) => {
    const box = app.querySelector('#advice'); if (!box || a.action === 'info') return;
    const icon = { book: '✓', wait: '⏳', flex: '⇄' }[a.action];
    mount(box, html`<div class="advice ${a.action}"><div class="ico2" aria-hidden="true">${icon}</div>
      <div><strong>${a.headline}</strong><ul>${a.reasons.map((r) => html`<li>${r}</li>`)}</ul></div>
      <div class="conf"><span>Confidence ${a.confidence}%</span><div class="meter"><i style="width:${a.confidence}%"></i></div>${a.action === 'flex' ? html`<button type="button" class="btn sm" id="useday" style="margin-top:6px">Use ${dayLabel(a.bestDay)}</button>` : ''}</div></div>`);
    box.querySelector('#useday')?.addEventListener('click', () => { const q = new URLSearchParams(query); q.set('date', a.bestDay); if (q.get('returnDate') && q.get('returnDate') < a.bestDay) q.delete('returnDate'); location.hash = `#/flights?${q}`; });
  }).catch(() => {});

  // Flexible dates: cheapest fare for the days around the chosen date.
  api('/flights/calendar', { query: { origin: query.origin, destination: query.destination, date: query.date, adults, cabin: query.cabin } }).then(({ days }) => {
    const cal = app.querySelector('#calendar'); if (!cal) return;
    const low = Math.min(...days.filter((d) => d.price).map((d) => d.price));
    mount(cal, html`${days.map((d) => html`<button type="button" data-day="${d.date}" class="${d.date === query.date ? 'sel' : ''} ${d.price === low ? 'low' : ''}" ${d.price ? '' : raw('disabled')}><small>${dayLabel(d.date)}</small><b>${d.price ? money(d.price) : 'No fare'}</b>${d.price === low ? html`<small>Lowest</small>` : ''}</button>`)}`);
    cal.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      const q = new URLSearchParams(query); q.set('date', b.dataset.day);
      if (q.get('returnDate') && q.get('returnDate') < b.dataset.day) q.delete('returnDate');
      location.hash = `#/flights?${q}`;
    }));
  }).catch(() => { app.querySelector('#calendar')?.remove(); });

  list.addEventListener('click', async (e) => {
    const sh = e.target.closest('[data-share]'); if (!sh) return;
    const o = offers.find((x) => x.id === sh.dataset.share);
    const a = o.itineraries[0].segments[0], z = o.itineraries[0].segments.at(-1);
    const text = `✈ ${a.from} → ${z.to}, ${dayLabel(a.departAt)}\n${a.carrierName} ${a.number} · ${hhmm(a.departAt)} to ${hhmm(z.arriveAt)} · ${dur(o.itineraries[0].durationMinutes)} · ${stopsLabel(o.itineraries[0])}\nFare ${money(o.price.total, o.price.currency)} for ${adults} traveller${adults > 1 ? 's' : ''}.\nPrices can change until booked.`;
    try { await navigator.clipboard.writeText(text); toast('Quote copied'); } catch { /* ignore */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'stops') state.stops = t.value;
    if (t.name === 'airline') t.checked ? state.airlines.add(t.value) : state.airlines.delete(t.value);
    if (t.name === 'time') t.checked ? state.times.add(t.value) : state.times.delete(t.value);
    if (t.name === 'stops' || t.name === 'airline' || t.name === 'time') draw();
  });
  app.querySelector('[name=price]').addEventListener('input', (e) => { state.maxPrice = Number(e.target.value); app.querySelector('#maxlabel').textContent = money(state.maxPrice); draw(); });
  app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    app.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    draw();
  }));
}

function leg(it, label) {
  const a = it.segments[0], z = it.segments.at(-1);
  return html`<div class="leg"><div class="logo" title="${a.carrierName}">${a.carrier}</div>
    <div><div class="times"><div><div class="t num">${hhmm(a.departAt)}</div><div class="iata">${a.from} · ${dayLabel(a.departAt)}</div></div>
      <div class="path">${dur(it.durationMinutes)}<i></i>${stopsLabel(it)}</div>
      <div style="text-align:right"><div class="t num">${hhmm(z.arriveAt)}</div><div class="iata">${z.to} · ${dayLabel(z.arriveAt)}</div></div></div>
      <div class="small muted" style="margin-top:4px">${label ? `${label} · ` : ''}${[...new Set(it.segments.map((s) => s.carrierName))].join(' + ')} · ${it.segments.map((s) => s.number).join(', ')}</div></div></div>`;
}
function offerCard(o, adults, f = {}, agent = false) {
  return html`<article class="card offer">
    <div>${f.cheap || f.fast || f.best ? html`<div class="badge-row">${f.best ? html`<span class="pill best">★ Best value</span>` : ''}${f.cheap ? html`<span class="pill cheap">Cheapest</span>` : ''}${f.fast ? html`<span class="pill fast">Fastest</span>` : ''}</div>` : ''}${o.itineraries.map((it, i) => leg(it, o.itineraries.length > 1 ? (i ? 'Return' : 'Outbound') : ''))}
      <div class="tags"><span class="chip plain">${cabinLabel(o.cabin)}</span><span class="chip plain">${o.checkedBags}</span>
        ${o.refundable === true ? html`<span class="chip good">Refundable</span>` : o.refundable === false ? html`<span class="chip plain">Non-refundable</span>` : ''}
        ${o.seatsLeft && o.seatsLeft < 5 ? html`<span class="chip warn">${o.seatsLeft} seats left</span>` : ''}</div></div>
    <div class="buy"><div><div class="price num">${money(o.price.total, o.price.currency)}</div>
      <div class="small muted">${adults > 1 ? `${money(o.price.perAdult, o.price.currency)} per adult` : 'per traveller, taxes included'}</div></div>
      <div class="row" style="justify-content:flex-end;gap:8px">${agent ? html`<button type="button" class="btn ghost sm" data-share="${o.id}" title="Copy a quote and open WhatsApp">Share quote</button>` : ''}<a class="btn" href="#/checkout/flight/${o.id}">Select</a></div></div>
  </article>`;
}

/* ============================== HOTEL RESULTS ============================== */
const HUES = [200, 28, 160, 340, 260, 90];
const hueOf = (s) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export async function hotelResults({ query, app }) {
  const city = query.cityName || query.cityCode;
  document.title = `Hotels in ${city} · Marichi Pulse`;
  mount(app, html`<div class="rhead"><div><h1>Hotels in ${city}</h1><p class="muted">Checking rooms and prices…</p></div></div>${skeletons}`);
  const { cityName, ...q } = query;
  let data;
  try { data = await api('/hotels/search', { query: q }); } catch (e) { return mount(app, errorBox(e, '#/?tab=hotels')); }
  const hotels = data.hotels.filter((h) => h.offers.length);
  const nights = nightsBetween(query.checkIn, query.checkOut);
  const cheapest = (h) => Math.min(...h.offers.map((o) => o.price.perNight));
  const top = Math.max(...hotels.map(cheapest), 0);
  const state = { sort: 'price', stars: 0, free: false, max: top, open: new Set() };

  mount(app, html`
    <div class="rhead"><div><h1>Hotels in ${city}</h1>
      <p class="muted">${dayLabel(query.checkIn)} to ${dayLabel(query.checkOut)} · ${nights} night${nights > 1 ? 's' : ''} · ${query.adults} guest${query.adults > 1 ? 's' : ''} · ${query.rooms} room${query.rooms > 1 ? 's' : ''}</p></div>
      <a class="btn ghost sm" href="#/?tab=hotels">Change search</a></div>
    <div class="layout">
      <aside class="card filters" aria-label="Filters">
        <fieldset><legend>Star rating</legend>${[[0, 'Any'], [3, '3 stars and up'], [4, '4 stars and up'], [5, '5 stars']].map(([v, l]) => html`<label><input type="radio" name="stars" value="${v}" ${v === 0 ? raw('checked') : ''}> ${l}</label>`)}</fieldset>
        <fieldset><legend>Cancellation</legend><label><input type="checkbox" name="free"> Free cancellation</label></fieldset>
        <fieldset><legend>Max per night <span id="maxlabel" class="muted small num">${money(top)}</span></legend><input type="range" name="price" min="0" max="${Math.ceil(top)}" value="${Math.ceil(top)}" step="100" aria-label="Maximum price per night"></fieldset>
      </aside>
      <section class="stack"><div class="row"><span id="count" class="muted"></span>
        <div class="sorts" role="group" aria-label="Sort">${[['price', 'Cheapest'], ['rating', 'Top rated'], ['distance', 'Closest']].map(([v, l]) => html`<button type="button" data-sort="${v}" aria-pressed="${v === 'price'}">${l}</button>`)}</div></div>
        <div id="list" class="stack"></div></section>
    </div>`);

  const list = app.querySelector('#list');
  const draw = () => {
    let l = hotels.filter((h) => (h.stars || 0) >= state.stars && cheapest(h) <= state.max && (!state.free || h.offers.some((o) => o.cancellation.refundable)));
    const cmp = { price: (a, b) => cheapest(a) - cheapest(b), rating: (a, b) => (b.score || 0) - (a.score || 0) || (b.stars || 0) - (a.stars || 0), distance: (a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99) }[state.sort];
    l = [...l].sort(cmp);
    app.querySelector('#count').textContent = `${l.length} of ${hotels.length} hotels`;
    mount(list, l.length ? html`${l.map((h) => hotelCard(h, nights, state))}` : html`<div class="card empty"><h3>No hotels match these filters</h3><p class="muted">Loosen a filter to see more.</p></div>`);
  };
  draw();

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'stars') state.stars = Number(t.value);
    if (t.name === 'free') state.free = t.checked;
    if (t.name === 'stars' || t.name === 'free') draw();
  });
  app.querySelector('[name=price]').addEventListener('input', (e) => { state.max = Number(e.target.value); app.querySelector('#maxlabel').textContent = money(state.max); draw(); });
  app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    app.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    draw();
  }));
  list.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) { const id = t.dataset.toggle; state.open.has(id) ? state.open.delete(id) : state.open.add(id); return draw(); }
    const r = e.target.closest('[data-reserve]');
    if (r) {
      const h = hotels.find((x) => x.id === r.dataset.hotel);
      const o = h.offers.find((x) => x.id === r.dataset.reserve);
      memory.hotelOffer = { hotel: h, offer: o, query: q };
      location.hash = `#/checkout/hotel/${encodeURIComponent(o.id)}`;
    }
  });
}

function hotelCard(h, nights, state) {
  const best = h.offers.reduce((a, b) => (a.price.perNight <= b.price.perNight ? a : b));
  const open = state.open.has(h.id);
  const hue = hueOf(h.name);
  const offers = [...h.offers].sort((a, b) => a.price.total - b.price.total);
  return html`<article class="card hotel">
    <div class="pic" style="background:linear-gradient(135deg,hsl(${hue} 55% 38%),hsl(${hue + 40} 60% 55%))" aria-hidden="true">${h.name[0]}</div>
    <div>
      <div class="hbody">
        <div class="row"><div><h3>${h.name}</h3><div class="small muted"><span class="stars">${starsText(h.stars)}</span> ${h.address ? `· ${h.address}` : ''}${h.distanceKm != null ? ` · ${h.distanceKm} km from centre` : ''}</div></div>
          ${h.score ? html`<div style="text-align:right"><span class="score">${h.score}</span><div class="small muted">${(h.reviews || 0).toLocaleString('en-GB')} reviews</div></div>` : ''}</div>
        ${h.amenities?.length ? html`<div class="tags" style="margin:0">${h.amenities.map((a) => html`<span class="chip plain">${a}</span>`)}</div>` : ''}
        <div class="row"><span class="chip ${best.cancellation.refundable ? 'good' : 'plain'}">${h.offers.some((o) => o.cancellation.refundable) ? 'Free cancellation available' : 'Non-refundable rates'}</span>
          <div style="text-align:right"><span class="small muted">from</span> <span class="price num">${money(best.price.perNight, best.price.currency)}</span><span class="small muted"> / night</span>
          <div class="small muted">${money(best.price.total, best.price.currency)} total for ${nights} night${nights > 1 ? 's' : ''}</div></div></div>
        <button class="btn ghost sm" data-toggle="${h.id}" style="justify-self:start" aria-expanded="${open}">${open ? 'Hide rooms' : `View ${h.offers.length} room option${h.offers.length > 1 ? 's' : ''}`}</button>
      </div>
      ${open ? html`<div class="rooms">${offers.map((o) => html`<div class="room"><div><strong>${o.room.type}</strong><div class="small muted">${o.room.bed} · ${o.board}</div>
        <div class="tags" style="margin-top:6px"><span class="chip ${o.cancellation.refundable ? 'good' : 'plain'}">${o.cancellation.text}</span></div></div>
        <div class="buy"><div><div class="price num">${money(o.price.total, o.price.currency)}</div><div class="small muted">${money(o.price.perNight, o.price.currency)} / night, taxes included</div></div>
        <button class="btn sm" data-hotel="${h.id}" data-reserve="${o.id}">Reserve</button></div></div>`)}</div>` : ''}
    </div></article>`;
}
void toast;
