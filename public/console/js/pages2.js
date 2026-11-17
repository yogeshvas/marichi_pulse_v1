import { api, html, raw, mount, modal, money, toast, kpi, num, when, day, table, bindRows, pager, drawer, statusChip, typeIcon, loading, field } from './kit.js';
import { showErrors, setBusy } from '/js/ui.js';
import { openBooking } from './pages1.js';

const YEAR = new Date().getFullYear();

/* ============================== AGENT: NEW BOOKING ============================== */
export async function newBooking({ app }) {
  const { customers } = await api('/agent/customers');
  mount(app, html`<div class="page-h"><div><h1>New booking</h1><p>Search live fares and rooms at your agent rates, then book for a customer.</p></div></div>
    <div class="grid-charts"><a class="card chart c6" href="/#/" style="text-decoration:none;color:inherit"><span style="font-size:34px">✈</span><h2>Book a flight</h2><p class="muted">One way or return, with seat selection.</p><span class="btn" style="justify-self:start">Search flights</span></a>
      <a class="card chart c6" href="/#/?tab=hotels" style="text-decoration:none;color:inherit"><span style="font-size:34px">🏨</span><h2>Book a hotel</h2><p class="muted">Rooms with clear cancellation terms.</p><span class="btn" style="justify-self:start;background:var(--hotel)">Search hotels</span></a></div>
    <section class="stack"><h2>Your recent customers</h2>${customers.length ? html`<div class="pops">${customers.slice(0, 8).map((c) => html`<a class="chip plain" href="#/customers?open=${c.id}">${c.name}</a>`)}</div>` : html`<p class="muted">No customers yet. Add one when you book, or from Customers.</p>`}</section>`);
}

/* ============================== AGENT: CUSTOMERS ============================== */
export async function customers({ app, user, query }) {
  mount(app, html`<div class="page-h"><div><h1>Customers</h1><p>Your own customer list. Only you can see it.</p></div><button class="btn" id="add">Add customer</button></div>
    <label class="field" style="max-width:360px"><span>Search</span><input id="q" placeholder="Name, email or phone"></label><div id="list">${loading}</div>`);
  let q = '', timer;
  const load = async () => {
    const { customers: rows } = await api('/agent/customers', { query: { q } });
    const list = app.querySelector('#list');
    mount(list, table([
      { h: 'Customer', v: (c) => html`<strong>${c.name}</strong><div class="small muted">${c.email || ''}</div>` }, { h: 'Phone', v: (c) => c.phone || '' },
      { h: 'Bookings', r: true, v: (c) => num(c.bookings) }, { h: 'Spent', r: true, v: (c) => money(c.spent) }, { h: 'Last booking', v: (c) => (c.last_booking ? day(c.last_booking) : 'None yet') },
    ], rows, { onRow: true, empty: 'No customers found' }));
    bindRows(list, rows, (c) => openCustomer(c.id, load));
  };
  app.querySelector('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value; load(); }, 250); });
  app.querySelector('#add').addEventListener('click', () => customerForm(null, load));
  await load();
  if (query.open) openCustomer(query.open, load);
}

function customerForm(c, onSaved) {
  const m = modal(html`<div></div>`);
  mount(m.el, html`<div class="row"><h2>${c ? 'Edit customer' : 'Add customer'}</h2><button class="link" data-x>Close</button></div>
    <form class="stack" novalidate>${field('Name', 'name', { value: c?.name || '' })}${field('Email', 'email', { type: 'email', value: c?.email || '', required: false })}${field('Phone', 'phone', { value: c?.phone || '', required: false })}
    <label class="field"><span>Notes</span><input name="notes" value="${c?.notes || ''}" placeholder="Preferences, passport expiry…"></label><button class="btn" type="submit">Save</button></form>`);
  m.el.querySelector('[data-x]').addEventListener('click', m.close);
  const f = m.el.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
    try { await api(c ? `/agent/customers/${c.id}` : '/agent/customers', { method: c ? 'PUT' : 'POST', body: Object.fromEntries(new FormData(f)) }); m.close(); toast('Saved'); onSaved(); }
    catch (err) { setBusy(btn, false); if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
  });
}

async function openCustomer(id, onChange) {
  const d = drawer(loading);
  const { customer: c, bookings, insight } = await api(`/agent/customers/${id}`);
  mount(d.el, html`<div class="row"><h2>${c.name}</h2><button class="link" id="x">Close</button></div>
    <div class="kv"><div><small>Email</small>${c.email || 'None'}</div><div><small>Phone</small>${c.phone || 'None'}</div><div><small>Bookings</small>${c.bookings}</div><div><small>Spent</small>${money(c.spent)}</div></div>
    ${insight ? html`<div class="insight ${insight.dueNow ? 'info' : 'good'}"><strong>✦ Pulse insight</strong><span>${insight.text}</span><span class="tags">${insight.tags.map((t) => html`<span class="chip plain">${t}</span>`)}</span></div>` : ''}
    ${c.notes ? html`<p class="muted">${c.notes}</p>` : ''}
    <div class="row"><a class="btn sm" href="/#/">Book for ${c.name.split(' ')[0]}</a><span><button class="btn ghost sm" id="edit">Edit</button> <button class="btn ghost sm" id="del">Delete</button></span></div>
    <h3>Booking history</h3>${bookings.length ? html`<div class="stack">${bookings.map((b) => html`<div class="row card" style="padding:10px 14px">${typeIcon(b.type)} <span style="flex:1"><strong>${b.summary.title}</strong><div class="small muted">${b.ref} · ${day(b.created_at)}</div></span>${statusChip(b.status)}<b class="num">${money(b.total)}</b></div>`)}</div>` : html`<p class="muted">No bookings yet.</p>`}`);
  d.el.querySelector('#x').addEventListener('click', d.close);
  d.el.querySelector('#edit').addEventListener('click', () => { d.close(); customerForm(c, onChange); });
  d.el.querySelector('#del').addEventListener('click', async () => { try { await api(`/agent/customers/${id}`, { method: 'DELETE' }); d.close(); toast('Customer deleted'); onChange(); } catch (e) { toast(e.message); } });
}

/* ============================== AGENT: WALLET ============================== */
const TYPE = { topup: 'Top-up', booking: 'Booking', refund: 'Refund', commission: 'Commission', commission_reversal: 'Commission reversed', service_fee: 'Service fee', fee_reversal: 'Fee reversed', adjustment_credit: 'Adjustment', adjustment_debit: 'Adjustment' };
export async function wallet({ app }) {
  let page = 1;
  const draw = async () => {
    const w = await api('/agent/wallet', { query: { page } });
    mount(app, html`<div class="page-h"><div><h1>Wallet</h1><p>Bookings paid from the wallet use your agent rates. Commission is added to it.</p></div><button class="btn" id="top">Top up</button></div>
      <div class="kpis">${kpi('Balance', money(w.balance), w.balance < 0 ? 'Using your credit line' : 'Available to spend')}${kpi('Credit limit', money(w.creditLimit), 'Set by the platform')}${kpi('Spendable now', money(w.balance + w.creditLimit), 'Balance plus credit')}</div>
      <h2>Transactions</h2>${table([
        { h: 'Date', v: (t) => when(t.created_at) }, { h: 'Type', v: (t) => TYPE[t.type] || t.type }, { h: 'Booking', v: (t) => t.booking_ref || '' }, { h: 'Note', v: (t) => t.note || '' },
        { h: 'Amount', r: true, v: (t) => html`<span class="${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${money(t.amount)}</span>` }, { h: 'Balance', r: true, v: (t) => money(t.balance_after) },
      ], w.txns, { empty: 'No transactions yet' })}${pager(w.page, w.pageSize, w.total)}`);
    app.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.pg); draw(); }));
    app.querySelector('#top').addEventListener('click', () => topup(draw));
  };
  draw();
}
function topup(done) {
  const m = modal(html`<div></div>`);
  mount(m.el, html`<div class="row"><h2>Top up wallet</h2><button class="link" data-x>Close</button></div>
    <form class="stack" novalidate>${field('Amount (ZMW)', 'amount', { type: 'number', value: 5000, attrs: 'min="100" step="100"' })}
      <div class="seg" role="radiogroup" aria-label="Payment method"><label><input type="radio" name="pay.method" value="momo" checked><span>Mobile money</span></label><label><input type="radio" name="pay.method" value="card"><span>Card</span></label></div>
      <div id="momobox" class="stack"><div class="grid g2"><label class="field"><span>Network</span><select name="momo.network"><option value="mtn">MTN Mobile Money</option><option value="airtel">Airtel Money</option><option value="zamtel">Zamtel Kwacha</option></select></label>${field('Mobile number', 'momo.phone', { placeholder: '097 123 4567' })}</div><p class="note">Approve the prompt on your phone.</p></div>
      <div id="cardsbox" class="stack" hidden>${field('Card number', 'card.number', { value: '4111 1111 1111 1111' })}${field('Name on card', 'card.holder', { value: 'Agent Account' })}
        <div class="grid g3"><label class="field"><span>Month</span><select name="card.expMonth">${Array.from({ length: 12 }, (_, i) => html`<option value="${i + 1}">${String(i + 1).padStart(2, '0')}</option>`)}</select></label>
          <label class="field"><span>Year</span><select name="card.expYear">${Array.from({ length: 8 }, (_, i) => html`<option value="${YEAR + i}" ${i === 3 ? raw('selected') : ''}>${YEAR + i}</option>`)}</select></label>${field('CVV', 'card.cvv', { value: '123' })}</div></div>
      <button class="btn" type="submit">Add money</button><p class="note">Demo gateway. Any valid Zambian number works.</p></form>`);
  m.el.querySelector('[data-x]').addEventListener('click', m.close);
  const f = m.el.querySelector('form');
  const toggle = () => { const v = f.querySelector('[name="pay.method"]:checked').value; f.querySelector('#momobox').hidden = v !== 'momo'; f.querySelector('#cardsbox').hidden = v !== 'card'; };
  f.querySelectorAll('[name="pay.method"]').forEach((r) => r.addEventListener('change', toggle));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const el = f.elements; const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
    const isMomo = f.querySelector('[name="pay.method"]:checked').value === 'momo';
    const body = { amount: Number(el.amount.value), ...(isMomo ? { momo: { network: el['momo.network'].value, phone: el['momo.phone'].value } } : { card: { number: el['card.number'].value, holder: el['card.holder'].value, expMonth: Number(el['card.expMonth'].value), expYear: Number(el['card.expYear'].value), cvv: el['card.cvv'].value } }) };
    try { await api('/agent/wallet/topup', { method: 'POST', body }); m.close(); toast('Wallet topped up'); done(); }
    catch (err) { setBusy(btn, false); if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
  });
}

/* ============================== AGENT: PROFILE ============================== */
export async function profile({ app, user }) {
  const { agent } = await api('/agent/me');
  mount(app, html`<div class="page-h"><div><h1>Agency profile</h1></div></div>
    <div class="grid g2" style="align-items:start"><form class="card stack" novalidate>${field('Agency name', 'agency', { value: agent.agency })}${field('Your name', 'name', { value: agent.name })}${field('Phone', 'phone', { value: agent.phone, placeholder: '+260971234567', required: false })}
      <label class="field"><span>Email</span><input value="${agent.email}" disabled></label><button class="btn" type="submit" style="justify-self:start">Save</button></form>
      <div class="card sum"><h3>Your terms</h3><div><span>Commission</span><b>${agent.commissionPct}% of base fare</b></div><div><span>Credit limit</span><b>${money(agent.creditLimit)}</b></div><div><span>Status</span>${statusChip(agent.status)}</div><div><span>Member since</span><span>${day(agent.since)}</span></div>
        <p class="note">Commission and credit are set by the platform. Contact support to change them.</p></div></div>`);
  const f = app.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
    try { await api('/agent/me', { method: 'PATCH', body: Object.fromEntries(new FormData(f)) }); toast('Profile saved'); }
    catch (err) { if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
    setBusy(btn, false);
  });
}
