import { api, delta, html, raw, mount, money, toast, kpi, num, pctText, when, day, newRange, rangeBar, table, bindRows, pager, drawer, statusChip, typeIcon, downloadCsv, loading, field } from './kit.js';
import { lineChart, columns, hbars, donut, compact } from './charts.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const money0 = (n) => money(n);

/* ============================== DASHBOARD ============================== */
export async function dashboard({ app, user }) {
  const admin = user.role === 'admin';
  const st = newRange();
  mount(app, html`<div class="page-h"><div><h1>${admin ? 'Business overview' : 'Your dashboard'}</h1><p>${admin ? 'Sales, revenue and agent activity across the platform.' : 'Your sales, commission and upcoming travel.'}</p></div></div>
    <div id="bar"></div><div id="body">${loading}</div>`);
  const load = async () => {
    const body = app.querySelector('#body');
    const [o, extra] = await Promise.all([
      api('/reports/overview', { query: { from: st.from, to: st.to, type: st.type } }),
      admin ? api('/admin/system') : api('/agent/wallet'),
    ]);
    const k = o.kpis, pv = o.previous || {}, dates = o.series.map((s) => s.date);
    const ins = await api('/reports/insights', { query: { from: st.from, to: st.to, type: st.type } }).then((r) => r.insights).catch(() => []);
    const up = admin ? null : await api('/bookings/manage', { query: { upcoming: 1, pageSize: 6 } });
    const recent = await api('/bookings/manage', { query: { pageSize: 6 } });
    mount(body, html`
      ${admin && extra.counts.pendingAgents ? html`<div class="alert warn" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><strong>${extra.counts.pendingAgents} agent${extra.counts.pendingAgents > 1 ? 's' : ''} waiting for approval.</strong></span><a href="#/agents?status=pending">Review</a></div>` : ''}
      ${!admin && extra.balance < 5000 ? html`<div class="alert warn" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><strong>Your wallet is low:</strong> ${money0(extra.balance)}.</span><a href="#/wallet">Top up</a></div>` : ''}
      ${ins.length ? html`<section class="card" style="padding:16px"><div class="row" style="margin-bottom:10px"><h3>✦ Pulse insights</h3><span class="note">Generated from your numbers</span></div>
        <div class="insights">${ins.map((i) => html`<div class="insight ${i.level}"><strong>${i.title}</strong><span>${i.detail}</span>${i.action ? html`<a href="${i.action.href}">${i.action.label} →</a>` : ''}</div>`)}</div></section>` : ''}
      <div class="kpis">
        ${admin ? html`${kpi('Gross sales', money0(k.sales), `${num(k.confirmed)} confirmed bookings`, delta(k.sales, pv.sales))}${kpi('Platform revenue', money0(k.revenue), 'After commission and discounts', delta(k.revenue, pv.revenue))}${kpi('Bookings', num(k.bookings), `${pctText(k.cancelRate)} cancelled`, delta(k.bookings, pv.bookings))}${kpi('Avg booking', money0(k.avgValue), `${num(k.customers)} customers`, delta(k.avgValue, pv.avgValue))}${kpi('Search to booking', pctText(k.conversion), `${num(k.searches)} searches`, delta(k.conversion, pv.conversion))}${kpi('Discounts given', money0(k.discounts), 'Promo codes and points', delta(k.discounts, pv.discounts, { invert: true }))}`
          : html`${kpi('Sales', money0(k.sales), `${num(k.confirmed)} confirmed bookings`, delta(k.sales, pv.sales))}${kpi('Commission earned', money0(k.commission), 'Paid into your wallet', delta(k.commission, pv.commission))}${kpi('Service fees', money0(k.serviceFees), 'Added to customer price')}${kpi('Wallet balance', money0(extra.balance), `Credit limit ${money0(extra.creditLimit)}`)}${kpi('Customers served', num(k.customers), `${pctText(k.cancelRate)} cancelled`)}${kpi('Search to booking', pctText(k.conversion), `${num(k.searches)} searches`)}`}
      </div>
      <div class="grid-charts">
        <section class="card chart c8"><h3>Sales over time and 14 day forecast</h3><div id="c-sales"></div><p class="note">The dashed line is a forecast from the last 4 weeks and your usual weekday pattern.</p></section>
        <section class="card chart c4"><h3>Flights and hotels</h3><div id="c-mix"></div><p class="note">Share of sales in the range.</p></section>
        <section class="card chart c6"><h3>Bookings per day</h3><div id="c-book"></div></section>
        ${admin ? html`<section class="card chart c6"><h3>Platform revenue over time</h3><div id="c-rev"></div></section>` : html`<section class="card chart c6"><h3>Busiest days to book</h3><div id="c-wd"></div></section>`}
        <section class="card chart c6"><h3>Top routes and cities</h3><div id="c-routes"></div></section>
        ${admin ? html`<section class="card chart c6"><h3>Top agents by sales</h3><div id="c-agents"></div></section>
          <section class="card chart c6"><h3>Direct and agent channel</h3><div id="c-chan"></div></section>
          <section class="card chart c6"><h3>Busiest days to book</h3><div id="c-wd"></div></section>`
          : html`<section class="card chart c6"><h3>Departing in the next 14 days</h3>${up.rows.length ? html`<div class="stack">${up.rows.map((b) => html`<div class="row"><span>${typeIcon(b.type)} <strong>${b.summary.title}</strong><div class="small muted">${b.customerName} · ${day(b.summary.startDate)}</div></span><a href="#/bookings?open=${b.ref}">${b.ref}</a></div>`)}</div>` : html`<p class="muted">Nothing departing soon.</p>`}</section>`}
      </div>
      <section class="stack"><div class="row"><h2>Recent bookings</h2><a href="#/bookings">View all</a></div>
        <div id="recent"></div></section>`);

    lineChart(body.querySelector('#c-sales'), { dates, values: o.series.map((s) => s.sales), fmt: (v) => `K${compact(v)}`, label: money0, name: 'Sales', forecast: o.forecast });
    columns(body.querySelector('#c-book'), { labels: dates.map((d) => day(d)), values: o.series.map((s) => s.bookings), fmt: (v) => String(v), name: 'Bookings', color: 'var(--s3)', tickLabels: dates.map((d) => d.slice(5)) });
    if (admin) lineChart(body.querySelector('#c-rev'), { dates, values: o.series.map((s) => s.revenue), fmt: (v) => `K${compact(v)}`, label: money0, name: 'Revenue', color: 'var(--s7)' });
    columns(body.querySelector('#c-wd'), { labels: WD, values: o.weekdays, fmt: (v) => String(v), name: 'Bookings', color: 'var(--s1)' });
    const color = { flight: 'var(--s1)', hotel: 'var(--s2)' };
    donut(body.querySelector('#c-mix'), o.mix.map((m) => ({ label: m.type === 'flight' ? 'Flights' : 'Hotels', value: m.sales, color: color[m.type] })), { fmt: (v) => `K${compact(v)}` });
    hbars(body.querySelector('#c-routes'), o.topRoutes.map((r) => ({ label: `${r.type === 'flight' ? '✈' : '🏨'} ${r.route.replace('-', ' → ')}`, value: r.n, color: color[r.type], text: `${r.n} · K${compact(r.sales)}` })), { fmt: String });
    if (admin) {
      hbars(body.querySelector('#c-agents'), (o.topAgents || []).map((a) => ({ label: a.agency, value: a.sales, text: `K${compact(a.sales)} · ${a.n}` })), { color: 'var(--s7)' });
      donut(body.querySelector('#c-chan'), o.channels.map((c) => ({ label: c.channel === 'agent' ? 'Agents' : 'Direct customers', value: c.sales, color: c.channel === 'agent' ? 'var(--s7)' : 'var(--s3)' })), { fmt: (v) => `K${compact(v)}` });
    }
    const rc = body.querySelector('#recent');
    mount(rc, bookingTable(recent.rows, admin));
    bindRows(rc, recent.rows, (b) => openBooking(b.ref, user, load));
  };
  rangeBar(app.querySelector('#bar'), st, load);
  load();
}

/* ============================== BOOKINGS ============================== */
function bookingTable(rows, admin) {
  return table([
    { h: 'Booking', v: (b) => html`${typeIcon(b.type)} <strong>${b.ref}</strong><div class="small muted">${b.providerRef}</div>` },
    { h: 'Trip', v: (b) => html`${b.summary.title}<div class="small muted">${b.summary.subtitle}</div>` },
    { h: 'Customer', v: (b) => html`${b.customerName}<div class="small muted">${b.customerEmail || ''}</div>` },
    ...(admin ? [{ h: 'Channel', v: (b) => (b.agency ? html`<span class="chip">${b.agency}</span>` : html`<span class="chip plain">Direct</span>`) }] : []),
    { h: 'Travel date', v: (b) => day(b.summary.startDate) },
    { h: 'Status', v: (b) => statusChip(b.status) },
    { h: 'Total', r: true, v: (b) => money(b.total, b.currency) },
  ], rows, { onRow: true, empty: 'No bookings match' });
}

export async function bookings({ app, user, query }) {
  const admin = user.role === 'admin';
  const st = { ...newRange(), preset: '', from: '', to: '', status: '', channel: '', agentId: '', q: '', page: 1 };
  mount(app, html`<div class="page-h"><div><h1>Bookings</h1><p>${admin ? 'Every booking on the platform.' : 'Everything you booked for customers.'}</p></div>
    <div class="row"><button class="btn ghost sm" id="csv">Export CSV</button>${admin ? '' : html`<a class="btn sm" href="/#/">New booking</a>`}</div></div>
    <form class="toolbar" id="f"><label class="field" style="flex:1;min-width:200px"><span>Search</span><input name="q" placeholder="Reference, customer, route…"></label>
      <label class="field"><span>Product</span><select name="type"><option value="">All</option><option value="flight">Flights</option><option value="hotel">Hotels</option></select></label>
      <label class="field"><span>Status</span><select name="status"><option value="">All</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="cancellation_requested">Cancel requested</option></select></label>
      ${admin ? html`<label class="field"><span>Channel</span><select name="channel"><option value="">All</option><option value="direct">Direct</option><option value="agent">Agents</option></select></label>` : ''}
      <label class="field"><span>From</span><input type="date" name="from"></label><label class="field"><span>To</span><input type="date" name="to"></label></form>
    <div id="list">${loading}</div>`);
  const form = app.querySelector('#f');
  let timer;
  const load = async () => {
    const list = app.querySelector('#list');
    const r = await api('/bookings/manage', { query: { ...st, pageSize: 12 } });
    mount(list, html`<div class="stack">${bookingTable(r.rows, admin)}${pager(r.page, r.pageSize, r.total)}</div>`);
    bindRows(list, r.rows, (b) => openBooking(b.ref, user, load));
    list.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => { st.page = Number(b.dataset.pg); load(); }));
  };
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { for (const el of form.elements) if (el.name) st[el.name] = el.value; st.page = 1; load(); }, 250); });
  form.addEventListener('submit', (e) => e.preventDefault());
  app.querySelector('#csv').addEventListener('click', () => downloadCsv('/reports/sales', { from: st.from || '2000-01-01', to: st.to, type: st.type }));
  await load();
  if (query.open) openBooking(query.open, user, load);
}

export async function openBooking(ref, user, onChange) {
  const admin = user.role === 'admin';
  const d = drawer(loading);
  let b;
  try { b = await api(`/bookings/${ref}`); } catch (e) { d.close(); return toast(e.message); }
  const x = b.details, flight = b.type === 'flight';
  const money2 = (n) => money(n, b.currency);
  mount(d.el, html`
    <div class="row"><div><span class="chip">${typeIcon(b.type)} ${flight ? 'Flight' : 'Hotel'}</span> ${statusChip(b.status)}</div><button class="link" id="x">Close</button></div>
    <div><h2>${b.summary.title}</h2><p class="muted">${b.summary.subtitle}</p></div>
    ${b.risk ? html`<div class="alert ${b.risk.level === 'high' ? '' : b.risk.level === 'medium' ? 'warn' : 'good'}"><strong>Risk: ${b.risk.level} (${b.risk.score}/100)</strong><ul style="margin:6px 0 0;padding-left:18px">${b.risk.reasons.map((r) => html`<li>${r}</li>`)}</ul></div>` : ''}
    <div class="kv"><div><small>Booking</small>${b.ref}</div><div><small>${flight ? 'Airline ref' : 'Hotel confirmation'}</small>${b.providerRef}</div><div><small>Booked</small>${when(b.createdAt)}</div>
      <div><small>Customer</small>${b.customerName}<div class="small muted">${b.customerEmail || ''}</div></div>
      <div><small>Channel</small>${b.agency ? `${b.agency}` : 'Direct'}</div><div><small>Travel</small>${day(b.summary.startDate)}${!flight ? ` to ${day(b.summary.endDate)}` : ''}</div></div>
    ${flight ? html`<div class="stack">${x.offer.itineraries.map((it) => html`<div class="card" style="padding:12px">${it.segments.map((s) => html`<div class="row"><span><strong>${s.from} → ${s.to}</strong><div class="small muted">${s.carrierName} ${s.number}</div></span><span class="small muted">${s.departAt.slice(11, 16)} to ${s.arriveAt.slice(11, 16)}</span></div>`)}</div>`)}
      <p class="small muted">Travellers: ${x.travelers.map((t) => `${t.firstName} ${t.lastName}`).join(', ')}</p></div>`
      : html`<div class="card" style="padding:12px"><strong>${x.offer.room.type}</strong><div class="small muted">${x.offer.room.bed} · ${x.offer.board} · ${x.offer.cancellation.text}</div><div class="small muted">Lead guest ${x.guest.firstName} ${x.guest.lastName}</div></div>`}
    <div class="card sum"><h3>Money</h3>
      <div><span>Customer pays</span><span class="num">${money2(b.total)}</span></div>
      ${b.serviceFee != null ? html`<div><span>Agent service fee</span><span class="num">${money2(b.serviceFee)}</span></div><div><span>Agent commission</span><span class="num">${money2(b.commission)}</span></div>` : ''}
      ${admin ? html`<div><span>Supplier cost</span><span class="num">${money2(b.supplierTotal)}</span></div><div><span>Platform markup</span><span class="num">${money2(b.markup)}</span></div>${b.discount ? html`<div><span>Discount given${b.promoCode ? ` (${b.promoCode})` : ''}</span><span class="num neg">−${money2(b.discount)}</span></div>` : ''}<div><span>Platform revenue</span><span class="num pos">${money2(b.markup - b.commission - b.discount)}</span></div>` : ''}
      <div><span>Payment</span><span>${b.paymentMode === 'wallet' ? 'Agent wallet' : 'Card'}</span></div>
      ${b.refundAmount != null ? html`<div class="tot"><span>Refunded</span><span class="num">${money2(b.refundAmount)}</span></div>` : ''}</div>
    <div class="row"><a class="btn ghost sm" href="/#/trips/${b.ref}" target="_blank" rel="noopener">Open voucher</a>
      ${b.canCancel ? html`<button class="btn danger sm" id="cancel">Cancel booking</button>` : ''}</div><div id="confirm"></div>`);
  d.el.querySelector('#x').addEventListener('click', d.close);
  d.el.querySelector('#cancel')?.addEventListener('click', (e) => {
    const c = d.el.querySelector('#confirm');
    mount(c, html`<div class="alert warn stack"><strong>Cancel ${b.ref}?</strong><span>${flight ? 'The airline cancellation fee will be deducted from the refund.' : x.offer.cancellation.refundable ? 'This room has free cancellation.' : 'This rate is non-refundable, so no refund is due.'} The agent commission is reversed.</span>
      <div class="row"><button class="btn ghost sm" data-no>Keep</button><button class="btn danger sm" data-yes>Yes, cancel</button></div></div>`);
    e.target.hidden = true;
    c.querySelector('[data-no]').addEventListener('click', () => { c.innerHTML = ''; e.target.hidden = false; });
    c.querySelector('[data-yes]').addEventListener('click', async () => { try { await api(`/bookings/${b.ref}/cancel`, { method: 'POST' }); toast('Booking cancelled'); d.close(); onChange?.(); } catch (err) { toast(err.message); } });
  });
}

/* ============================== REPORTS ============================== */
export async function reports({ app, user }) {
  const admin = user.role === 'admin';
  const tabs = admin ? [['sales', 'Sales'], ['agents', 'Agent performance'], ['cancellations', 'Cancellations']] : [['sales', 'Sales and commission'], ['cancellations', 'Cancellations']];
  const st = { ...newRange(), tab: 'sales' };
  mount(app, html`<div class="page-h"><div><h1>Reports</h1><p>Filter, review and export as CSV.</p></div><button class="btn ghost sm" id="csv">Export CSV</button></div>
    <div class="sorts" role="tablist" id="tabs">${tabs.map(([k, l]) => html`<button data-t="${k}" aria-pressed="${k === st.tab}">${l}</button>`)}</div>
    <div id="bar"></div><div id="out">${loading}</div>`);
  const path = () => ({ sales: '/reports/sales', agents: '/reports/agents', cancellations: '/reports/cancellations' }[st.tab]);
  const load = async () => {
    const out = app.querySelector('#out');
    const { rows } = await api(path(), { query: { from: st.from, to: st.to, type: st.type } });
    if (st.tab === 'sales') {
      const t = rows.filter((r) => r.status === 'confirmed').reduce((a, r) => ({ total: a.total + r.total, markup: a.markup + (r.markup || 0), comm: a.comm + (r.commission || 0), fee: a.fee + (r.service_fee || 0), cost: a.cost + (r.supplier_total || 0) }), { total: 0, markup: 0, comm: 0, fee: 0, cost: 0 });
      mount(out, html`<div class="kpis">${kpi('Confirmed sales', money(t.total), `${rows.filter((r) => r.status === 'confirmed').length} bookings`)}${admin ? kpi('Supplier cost', money(t.cost)) : ''}${admin ? kpi('Platform revenue', money(t.markup - t.comm), 'Markup less commission') : ''}${kpi('Commission paid', money(t.comm))}${kpi('Service fees', money(t.fee))}</div>
        <div style="margin-top:14px">${table([
          { h: 'Date', v: (r) => r.created_at.slice(0, 10) }, { h: 'Ref', v: (r) => html`<strong>${r.ref}</strong>` }, { h: 'Product', v: (r) => `${typeIcon(r.type)} ${r.route || ''}` },
          { h: 'Customer', v: (r) => r.customer_name }, ...(admin ? [{ h: 'Agent', v: (r) => r.agency || 'Direct' }] : []), { h: 'Status', v: (r) => statusChip(r.status) },
          ...(admin ? [{ h: 'Cost', r: true, v: (r) => money(r.supplier_total || 0) }, { h: 'Markup', r: true, v: (r) => money(r.markup || 0) }] : []),
          { h: 'Commission', r: true, v: (r) => money(r.commission || 0) }, { h: 'Total', r: true, v: (r) => money(r.total) },
        ], rows.slice(0, 200), { empty: 'No sales in this range' })}</div>${rows.length > 200 ? html`<p class="note">Showing the latest 200 of ${rows.length}. Export CSV for all rows.</p>` : ''}`);
    } else if (st.tab === 'agents') {
      mount(out, table([
        { h: 'Agent', v: (r) => html`<strong>${r.agency}</strong><div class="small muted">${r.name}</div>` }, { h: 'Status', v: (r) => statusChip(r.status) },
        { h: 'Bookings', r: true, v: (r) => num(r.bookings) }, { h: 'Cancelled', r: true, v: (r) => num(r.cancelled) }, { h: 'Sales', r: true, v: (r) => money(r.sales) },
        { h: 'Commission', r: true, v: (r) => money(r.commission) }, { h: 'Service fees', r: true, v: (r) => money(r.fees) }, { h: 'Wallet', r: true, v: (r) => money(r.wallet_balance) },
      ], rows, { empty: 'No agents' }));
    } else {
      mount(out, table([
        { h: 'Ref', v: (r) => html`<strong>${r.ref}</strong>` }, { h: 'Product', v: (r) => `${typeIcon(r.type)} ${r.route || ''}` }, { h: 'Customer', v: (r) => r.customer_name }, { h: 'Agent', v: (r) => r.agent || 'Direct' },
        { h: 'Cancelled', v: (r) => (r.cancelled_at || '').slice(0, 10) }, { h: 'Status', v: (r) => statusChip(r.status) }, { h: 'Paid', r: true, v: (r) => money(r.total) }, { h: 'Refunded', r: true, v: (r) => money(r.refund_amount || 0) },
      ], rows, { empty: 'No cancellations in this range' }));
    }
  };
  rangeBar(app.querySelector('#bar'), st, load);
  app.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.t; app.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', x === b)); load(); }));
  app.querySelector('#csv').addEventListener('click', () => downloadCsv(path(), { from: st.from, to: st.to, type: st.type }));
  load();
}
void raw; void field;
