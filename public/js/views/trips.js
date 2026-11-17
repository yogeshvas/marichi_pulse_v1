import { api } from '../api.js';
import { html, raw, mount, money, hhmm, dayLabel, longDate, dur, stopsLabel, cabinLabel, starsText, nightsBetween, setBusy, toast } from '../ui.js';
import { requireLogin } from '../auth.js';

const STATUS = {
  confirmed: ['Confirmed', 'good'], cancelled: ['Cancelled', 'bad'], cancellation_requested: ['Cancellation requested', 'warn'],
};
const chip = (s) => { const [l, k] = STATUS[s] || [s, 'plain']; return html`<span class="chip ${k}">${l}</span>`; };

async function needLogin(app) {
  mount(app, html`<div class="card empty"><h2>Sign in to see your trips</h2><p class="muted">Your tickets and hotel vouchers are saved to your account.</p><button class="btn" id="go">Sign in</button></div>`);
  app.querySelector('#go').addEventListener('click', async () => { if (await requireLogin('Sign in to see your trips.')) location.reload(); });
}

export async function trips({ app }) {
  document.title = 'My trips · Marichi Pulse';
  if (!(await requireLogin('Sign in to see your trips.'))) return needLogin(app);
  mount(app, html`<div class="skeleton"></div>`);
  let list;
  try { list = (await api('/bookings')).bookings; } catch (e) { return needLogin(app); }
  let tab = 'upcoming';
  const now = new Date().toISOString();
  const groups = () => ({
    upcoming: list.filter((b) => b.status === 'confirmed' && b.summary.endDate >= now),
    past: list.filter((b) => b.status === 'confirmed' && b.summary.endDate < now),
    cancelled: list.filter((b) => b.status !== 'confirmed'),
  });
  const draw = () => {
    const g = groups();
    mount(app, html`<div class="rhead"><h1>My trips</h1><a class="btn sm" href="#/">Book a trip</a></div>
      <div class="sorts" role="tablist" style="margin-bottom:14px">${['upcoming', 'past', 'cancelled'].map((k) => html`<button role="tab" data-tab="${k}" aria-pressed="${k === tab}">${k[0].toUpperCase() + k.slice(1)} (${g[k].length})</button>`)}</div>
      <div class="stack">${g[tab].length ? g[tab].map(card) : html`<div class="card empty"><h3>No ${tab} trips</h3><p class="muted">${tab === 'upcoming' ? 'Search a flight or hotel to start.' : 'Nothing here yet.'}</p></div>`}</div>`);
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  };
  draw();
}

const card = (b) => html`<a class="card trip" href="#/trips/${b.ref}" data-mode-${b.type}>
  <div class="ico" aria-hidden="true">${b.type === 'flight' ? '✈' : '🏨'}</div>
  <div><strong>${b.summary.title}</strong><div class="small muted">${dayLabel(b.summary.startDate)}${b.summary.endDate && b.type === 'hotel' ? ` to ${dayLabel(b.summary.endDate)}` : ''} · ${b.summary.subtitle}</div>
    <div class="small muted">Ref ${b.ref} · ${b.providerRef}</div></div>
  <div style="text-align:right">${chip(b.status)}<div class="price num" style="font-size:18px;margin-top:4px">${money(b.total, b.currency)}</div></div></a>`;

export async function tripDetail({ params, query, app }) {
  document.title = `Trip ${params[0]} · Marichi Pulse`;
  mount(app, html`<div class="skeleton"></div>`);
  if (!(await requireLogin('Sign in to see this trip.'))) return needLogin(app);
  let b, cfg;
  try { [b, cfg] = await Promise.all([api(`/bookings/${params[0]}`), api('/config')]); } catch (e) {
    return mount(app, html`<div class="card empty"><h2>Trip not found</h2><p class="muted">${e.message}</p><a class="btn" href="#/trips">My trips</a></div>`);
  }
  document.body.dataset.mode = b.type === 'hotel' ? 'hotel' : 'flight';
  const d = b.details;
  const flight = b.type === 'flight';

  const body = flight ? html`
    <div class="ticket"><div class="row"><span class="chip">E-ticket</span><span class="small muted">Airline booking reference</span></div>
      <div class="big">${b.providerRef}</div>
      ${d.offer.itineraries.map((it, i) => { const a = it.segments[0], z = it.segments.at(-1); return html`<div>
        <div class="small muted">${d.offer.itineraries.length > 1 ? (i ? 'Return' : 'Outbound') : 'Flight'} · ${longDate(a.departAt)} · ${dur(it.durationMinutes)} · ${stopsLabel(it)}</div>
        ${it.segments.map((s) => html`<div class="times" style="margin-top:8px"><div><div class="t num">${hhmm(s.departAt)}</div><div class="iata">${s.from}${s.terminalFrom ? ` · Terminal ${s.terminalFrom}` : ''}</div></div><div class="path">${s.carrierName} ${s.number}<i></i>${s.aircraft}</div><div style="text-align:right"><div class="t num">${hhmm(s.arriveAt)}</div><div class="iata">${s.to}</div></div></div>`)}</div>`; })}
      <div class="kv"><div><small>Cabin</small>${cabinLabel(d.offer.cabin)}</div><div><small>Baggage</small>${d.offer.checkedBags}</div>
        <div><small>Travellers</small>${d.travelers.map((t) => `${t.firstName} ${t.lastName}`).join(', ')}</div>
        <div><small>Seats</small>${d.seats.length ? d.seats.map((s) => `T${s.travelerIndex + 1}: ${s.number}`).join(', ') + (d.seatPurchase ? '' : ' (requested)') : 'Assigned at check-in'}</div></div>
      <div class="barcode" aria-hidden="true"></div></div>`
  : html`
    <div class="ticket"><div class="row"><span class="chip">Hotel voucher</span><span class="small muted">Confirmation number</span></div>
      <div class="big">${b.providerRef}</div>
      <div><h2>${d.hotel.name}</h2><div class="small muted"><span class="stars">${starsText(d.hotel.stars)}</span> ${d.hotel.address || ''}</div></div>
      <div class="kv"><div><small>Check in</small>${longDate(d.query.checkIn)}<div class="small muted">from 14:00</div></div><div><small>Check out</small>${longDate(d.query.checkOut)}<div class="small muted">until 11:00</div></div>
        <div><small>Stay</small>${nightsBetween(d.query.checkIn, d.query.checkOut)} nights · ${d.query.rooms} room${d.query.rooms > 1 ? 's' : ''}</div><div><small>Guests</small>${d.query.adults}</div></div>
      <div class="kv"><div><small>Room</small>${d.offer.room.type}<div class="small muted">${d.offer.room.bed}</div></div><div><small>Meals</small>${d.offer.board}</div>
        <div><small>Lead guest</small>${d.guest.firstName} ${d.guest.lastName}</div><div><small>Cancellation</small>${d.offer.cancellation.text}</div></div>
      <div class="barcode" aria-hidden="true"></div></div>`;

  mount(app, html`
    <p class="small"><a href="#/trips">← My trips</a></p>
    ${query.new ? html`<div class="alert good" role="status" style="margin-top:10px"><strong>${flight ? 'Flight booked.' : 'Hotel booked.'}</strong> A confirmation was sent to ${flight ? d.contact.email : d.guest.email}.${b.demo ? ' Demo booking, nothing was charged.' : ''}${b.pointsEarned ? html` <strong>You earned ${b.pointsEarned.toLocaleString('en-GB')} Pulse Points.</strong>` : ''}</div>` : ''}
    <div class="rhead" style="margin-top:14px"><div><h1>${b.summary.title}</h1><p class="muted">Booking ${b.ref} · ${chip(b.status)} ${countdown(b)}</p></div>
      <div class="row no-print"><button class="btn ghost sm" id="print">Print</button>${b.status === 'confirmed' ? html`<button class="btn ghost sm" id="ics">Add to calendar</button>` : ''}<a class="btn ghost sm" href="#/account?ticket=${b.ref}">Get help</a>${b.canCancel ? html`<button class="btn ghost sm" id="cancel">Cancel booking</button>` : ''}</div></div>
    <div class="co"><div class="stack">${body}
      ${b.status !== 'confirmed' ? html`<div class="alert ${b.status === 'cancelled' ? '' : 'warn'}">${b.status === 'cancelled' ? `Cancelled ${b.cancelledAt?.slice(0, 10) || ''}.` : 'We sent your cancellation request to the hotel provider. Our team will confirm by email.'}${b.refundAmount != null ? ` Refund: ${money(b.refundAmount, b.currency)}.` : ''}</div>` : ''}</div>
      <aside class="side"><div class="card sum"><h3>Payment</h3>
        ${flight ? html`<div><span>Fare</span><span class="num">${money(d.fare, b.currency)}</span></div>${d.seatFee ? html`<div><span>Seats</span><span class="num">${money(d.seatFee, b.currency)}</span></div>` : ''}`
          : html`<div><span>Room and taxes</span><span class="num">${money(b.total, b.currency)}</span></div>`}
        ${b.discount ? html`<div><span>Discount${b.promoCode ? ` (${b.promoCode})` : ''}${b.pointsUsed ? ` · ${b.pointsUsed} pts` : ''}</span><span class="num pos">−${money(b.discount, b.currency)}</span></div>` : ''}
        <div class="tot"><span>Total paid</span><span class="num">${money(b.total, b.currency)}</span></div>
        ${b.pointsEarned ? html`<div><span>Pulse Points earned</span><b>+${b.pointsEarned}</b></div>` : ''}
        <p class="small muted">${payText(d.pay)}</p></div></aside></div>`);

  app.querySelector('#print').addEventListener('click', () => window.print());
  app.querySelector('#ics')?.addEventListener('click', () => downloadIcs(b));
  const cancel = app.querySelector('#cancel');
  cancel?.addEventListener('click', () => {
    const rule = flight ? `A ${cfg.flightCancelFeePct}% cancellation fee applies. You get back ${money(b.total * (1 - cfg.flightCancelFeePct / 100), b.currency)}.`
      : d.offer.cancellation.refundable ? `Free cancellation applies. You get back ${money(b.total, b.currency)}.` : 'This rate is non-refundable. You will not get a refund.';
    const box = document.createElement('div');
    box.className = 'alert warn stack';
    box.innerHTML = '';
    mount(box, html`<strong>Cancel this booking?</strong><span>${rule}</span><div class="row"><button class="btn ghost sm" data-no>Keep booking</button><button class="btn danger sm" data-yes>Yes, cancel</button></div>`);
    cancel.closest('.rhead').after(box);
    cancel.disabled = true;
    box.querySelector('[data-no]').addEventListener('click', () => { box.remove(); cancel.disabled = false; });
    box.querySelector('[data-yes]').addEventListener('click', async (e) => {
      setBusy(e.target, true);
      try { await api(`/bookings/${b.ref}/cancel`, { method: 'POST' }); toast('Booking cancelled'); tripDetail({ params, query: {}, app }); }
      catch (err) { setBusy(e.target, false); toast(err.message); }
    });
  });
}
void raw;

function countdown(b) {
  if (b.status !== 'confirmed') return '';
  const start = new Date(`${b.summary.startDate.slice(0, 10)}T00:00:00`);
  const days = Math.round((start - new Date(new Date().toDateString())) / 864e5);
  if (days < 0) return html`<span class="chip plain">Completed</span>`;
  return html`<span class="chip countdown">${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>`;
}

/** Builds a calendar file so the trip can be added to Apple, Google or Outlook calendar. */
function downloadIcs(b) {
  const flight = b.type === 'flight';
  const pad = (iso) => iso.replace(/[-:]/g, '').slice(0, 15);
  const day = (iso) => iso.slice(0, 10).replace(/-/g, '');
  const esc = (t) => String(t).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  const ev = flight
    ? b.details.offer.itineraries.map((it, i) => ({ s: pad(it.segments[0].departAt), e: pad(it.segments.at(-1).arriveAt), t: `Flight ${it.segments[0].from} to ${it.segments.at(-1).to}`, d: `${it.segments.map((x) => `${x.carrierName} ${x.number}`).join(', ')}. Airline reference ${b.providerRef}.`, allDay: false, i }))
    : [{ s: day(b.details.query.checkIn), e: day(b.details.query.checkOut), t: `Stay at ${b.details.hotel.name}`, d: `${b.details.offer.room.type}. Confirmation ${b.providerRef}.`, allDay: true, i: 0 }];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marichi Pulse//EN', 'CALSCALE:GREGORIAN'];
  for (const e of ev) lines.push('BEGIN:VEVENT', `UID:${b.ref}-${e.i}@marichipulse`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    e.allDay ? `DTSTART;VALUE=DATE:${e.s}` : `DTSTART:${e.s}`, e.allDay ? `DTEND;VALUE=DATE:${e.e}` : `DTEND:${e.e}`, `SUMMARY:${esc(e.t)}`, `DESCRIPTION:${esc(e.d)}`, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${b.ref}.ics`; a.click(); URL.revokeObjectURL(a.href);
}

const NET_NAME = { mtn: 'MTN Mobile Money', airtel: 'Airtel Money', zamtel: 'Zamtel Kwacha' };
function payText(p) {
  if (p?.mode === 'wallet') return 'Paid from the agent wallet.';
  if (p?.method === 'momo') return `Paid with ${NET_NAME[p.network] || 'mobile money'} ending ${p.last4}.`;
  return `Paid with card ending ${p?.last4 || ''}.`;
}
