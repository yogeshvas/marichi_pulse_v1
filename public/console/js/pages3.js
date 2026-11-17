import { api, html, raw, mount, modal, money, toast, kpi, num, when, day, table, bindRows, pager, drawer, statusChip, loading, field } from './kit.js';
import { showErrors, setBusy } from '/js/ui.js';

/* ============================== ADMIN: AGENTS ============================== */
export async function agents({ app, query }) {
  let status = query.status || '';
  mount(app, html`<div class="page-h"><div><h1>Agents</h1><p>Approve agents, set commission and credit, and manage wallets.</p></div><button class="btn" id="add">Add agent</button></div>
    <div class="sorts" id="tabs">${[['', 'All'], ['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended']].map(([v, l]) => html`<button data-s="${v}" aria-pressed="${v === status}">${l}</button>`)}</div><div id="list">${loading}</div>`);
  const load = async () => {
    const { agents: rows } = await api('/admin/agents', { query: { status } });
    const list = app.querySelector('#list');
    mount(list, table([
      { h: 'Agency', v: (a) => html`<strong>${a.agency}</strong><div class="small muted">${a.name} · ${a.email}</div>` }, { h: 'Status', v: (a) => statusChip(a.status) },
      { h: 'Commission', r: true, v: (a) => `${a.commission_pct}%` }, { h: 'Wallet', r: true, v: (a) => money(a.wallet_balance) }, { h: 'Bookings', r: true, v: (a) => num(a.bookings) }, { h: 'Sales', r: true, v: (a) => money(a.sales) },
      { h: '', v: (a) => (a.status === 'pending' ? html`<button class="btn sm" data-approve="${a.id}">Approve</button>` : '') },
    ], rows, { onRow: true, empty: 'No agents here' }));
    bindRows(list, rows, (a) => agentDrawer(a, load));
    list.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); await api(`/admin/agents/${b.dataset.approve}`, { method: 'PATCH', body: { status: 'active' } }); toast('Agent approved'); load(); }));
  };
  app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { status = b.dataset.s; app.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); load(); }));
  app.querySelector('#add').addEventListener('click', () => createAgent(load));
  load();
}

function createAgent(done) {
  const m = modal(html`<div></div>`);
  mount(m.el, html`<div class="row"><h2>Add agent</h2><button class="link" data-x>Close</button></div>
    <form class="stack" novalidate>${field('Agency name', 'agency')}${field('Contact name', 'name')}${field('Email', 'email', { type: 'email' })}${field('Phone', 'phone', { placeholder: '+260971234567' })}${field('Temporary password', 'password', { type: 'password', attrs: 'minlength="8"' })}
    <div class="grid g2">${field('Commission %', 'commissionPct', { type: 'number', value: 1.5, attrs: 'step="0.1" min="0" max="20"' })}${field('Credit limit', 'creditLimit', { type: 'number', value: 0, attrs: 'step="1000" min="0"' })}</div>
    <button class="btn" type="submit">Create agent</button></form>`);
  m.el.querySelector('[data-x]').addEventListener('click', m.close);
  const f = m.el.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
    try { await api('/admin/agents', { method: 'POST', body: { ...v, commissionPct: Number(v.commissionPct), creditLimit: Number(v.creditLimit) } }); m.close(); toast('Agent created'); done(); }
    catch (err) { setBusy(btn, false); if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
  });
}

function agentDrawer(a, onChange) {
  const d = drawer(html`<div></div>`);
  mount(d.el, html`<div class="row"><div><h2>${a.agency}</h2><p class="muted">${a.name} · ${a.email}</p></div><button class="link" id="x">Close</button></div>
    <div class="kpis" style="grid-template-columns:1fr 1fr">${kpi('Wallet', money(a.wallet_balance))}${kpi('Sales', money(a.sales), `${num(a.bookings)} bookings`)}</div>
    <form class="stack" id="terms" novalidate><h3>Terms</h3><div class="grid g2">${field('Commission %', 'commissionPct', { type: 'number', value: a.commission_pct, attrs: 'step="0.1" min="0" max="20"' })}${field('Credit limit', 'creditLimit', { type: 'number', value: a.credit_limit, attrs: 'step="1000" min="0"' })}</div>
      <div class="row"><button class="btn" type="submit">Save terms</button>${a.status === 'suspended' ? html`<button class="btn ghost" type="button" data-st="active">Reactivate</button>` : html`<button class="btn ghost" type="button" data-st="suspended">Suspend</button>`}</div></form>
    <form class="stack" id="adj" novalidate><h3>Adjust wallet</h3><div class="grid g2">${field('Amount (use minus to deduct)', 'amount', { type: 'number', value: '', attrs: 'step="100"' })}${field('Reason', 'note')}</div><button class="btn ghost" type="submit" style="justify-self:start">Apply adjustment</button><p class="note">Every adjustment is recorded in the audit log.</p></form>`);
  d.el.querySelector('#x').addEventListener('click', d.close);
  d.el.querySelector('#terms').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target.elements; try { await api(`/admin/agents/${a.id}`, { method: 'PATCH', body: { commissionPct: Number(f.commissionPct.value), creditLimit: Number(f.creditLimit.value) } }); toast('Terms saved'); d.close(); onChange(); } catch (err) { toast(err.message); } });
  d.el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { await api(`/admin/agents/${a.id}`, { method: 'PATCH', body: { status: b.dataset.st } }); toast('Status updated'); d.close(); onChange(); }));
  d.el.querySelector('#adj').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api(`/admin/agents/${a.id}/wallet`, { method: 'POST', body: { amount: Number(f.elements.amount.value), note: f.elements.note.value } }); toast('Wallet adjusted'); d.close(); onChange(); } catch (err) { if (!(err.fields && showErrors(f, err.fields))) toast(err.message); } });
}

/* ============================== ADMIN: USERS ============================== */
export async function users({ app, user }) {
  const st = { q: '', role: 'customer' };
  mount(app, html`<div class="page-h"><div><h1>Users</h1><p>Customer, agent and admin accounts.</p></div></div>
    <div class="toolbar"><label class="field" style="flex:1;min-width:200px"><span>Search</span><input id="q" placeholder="Name or email"></label>
      <label class="field"><span>Role</span><select id="role"><option value="customer">Customers</option><option value="agent">Agents</option><option value="admin">Admins</option><option value="">All</option></select></label></div><div id="list">${loading}</div>`);
  const load = async () => {
    const { users: rows } = await api('/admin/users', { query: st });
    const list = app.querySelector('#list');
    mount(list, table([
      { h: 'Name', v: (u) => html`<strong>${u.name}</strong><div class="small muted">${u.email}</div>` }, { h: 'Role', v: (u) => html`<span class="chip plain">${u.role}</span>` }, { h: 'Joined', v: (u) => day(u.created_at) },
      { h: 'Bookings', r: true, v: (u) => num(u.bookings) }, { h: 'Spent', r: true, v: (u) => money(u.spent) }, { h: 'Status', v: (u) => statusChip(u.status) },
      { h: '', v: (u) => (u.id === user.id ? '' : html`<button class="btn ghost sm" data-u="${u.id}" data-to="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`) },
    ], rows, { empty: 'No users found' }));
    list.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/admin/users/${b.dataset.u}`, { method: 'PATCH', body: { status: b.dataset.to } }); toast('Updated'); load(); } catch (e) { toast(e.message); } }));
  };
  let t;
  app.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; load(); }, 250); });
  app.querySelector('#role').addEventListener('change', (e) => { st.role = e.target.value; load(); });
  load();
}

/* ============================== ADMIN: PRICING AND SETTINGS ============================== */
export async function settings({ app }) {
  const [{ settings: s }, sys] = await Promise.all([api('/admin/settings'), api('/admin/system')]);
  const num2 = (label, name, hint) => html`<label class="field"><span>${label}</span><input name="${name}" type="number" step="0.1" min="0" value="${s[name]}"><small class="muted">${hint}</small></label>`;
  mount(app, html`<div class="page-h"><div><h1>Pricing and settings</h1><p>Changes apply to new searches straight away.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <form class="card stack" id="f" novalidate><h2>Markup</h2><p class="muted small">Added on top of the airline or hotel price.</p>
        <div class="grid g2">${num2('Customer flights %', 'markupFlightPct', 'Direct customers')}${num2('Customer hotels %', 'markupHotelPct', 'Direct customers')}${num2('Agent flights %', 'agentMarkupFlightPct', 'Agent net rate')}${num2('Agent hotels %', 'agentMarkupHotelPct', 'Agent net rate')}</div>
        <h2>Rules</h2><div class="grid g2">${num2('Default agent commission %', 'defaultCommissionPct', 'For new agents')}${num2('Flight cancellation fee %', 'flightCancelFeePct', 'Kept on flight cancellations')}</div>
        <label class="field"><span>Support email</span><input name="supportEmail" type="email" value="${s.supportEmail}"></label><button class="btn" type="submit" style="justify-self:start">Save settings</button></form>
      <div class="stack"><div class="card sum"><h3>System</h3><div><span>Data source</span><span class="chip ${sys.mode === 'live' ? 'good' : 'warn'}">${sys.mode === 'live' ? 'Amadeus live' : 'Demo data'}</span></div>
        <div><span>Users</span><b>${num(sys.counts.users)}</b></div><div><span>Bookings</span><b>${num(sys.counts.bookings)}</b></div><div><span>Agents</span><b>${sys.counts.agents} (${sys.counts.pendingAgents} pending)</b></div><div><span>Open support tickets</span><b>${sys.counts.openTickets}</b></div>
        <div><span>Hotel agency card</span><span>${sys.agencyCardConfigured ? 'Configured' : 'Not set'}</span></div></div>
        ${sys.mode === 'demo' ? html`<div class="alert info">Running on demo data. Add Amadeus keys in <code>.env</code> to go live.</div>` : ''}
        <div class="card sum"><h3>Example</h3><p class="small muted">A K10,000 flight costs a customer ${money(10000 * (1 + s.markupFlightPct / 100))} and an agent ${money(10000 * (1 + s.agentMarkupFlightPct / 100))}.</p></div></div></div>`);
  const f = app.querySelector('#f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const body = { supportEmail: v.supportEmail };
    for (const k of Object.keys(v)) if (k !== 'supportEmail') body[k] = Number(v[k]);
    const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
    try { await api('/admin/settings', { method: 'PUT', body }); toast('Settings saved'); } catch (err) { if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
    setBusy(btn, false);
  });
}

/* ============================== ADMIN: AUDIT LOG ============================== */
export async function auditLog({ app }) {
  const st = { q: '', page: 1 };
  mount(app, html`<div class="page-h"><div><h1>Audit log</h1><p>Who changed what, and when.</p></div></div><label class="field" style="max-width:340px"><span>Search</span><input id="q" placeholder="Action, person or id"></label><div id="list">${loading}</div>`);
  const load = async () => {
    const r = await api('/admin/audit', { query: st });
    const list = app.querySelector('#list');
    mount(list, html`<div class="stack">${table([
      { h: 'When', v: (a) => when(a.created_at) }, { h: 'Who', v: (a) => a.user_name }, { h: 'Action', v: (a) => html`<span class="chip plain">${a.action}</span>` }, { h: 'Item', v: (a) => `${a.entity || ''} ${a.entity_id || ''}` },
      { h: 'Details', v: (a) => html`<span class="small muted">${a.meta ? JSON.stringify(a.meta).slice(0, 90) : ''}</span>` },
    ], r.rows, { empty: 'No entries' })}${pager(r.page, r.pageSize, r.total)}</div>`);
    list.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => { st.page = Number(b.dataset.pg); load(); }));
  };
  let t;
  app.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 250); });
  load();
}

/* ============================== SUPPORT (agent + admin) ============================== */
export async function supportPage({ app, user }) {
  let status = 'open';
  mount(app, html`<div class="page-h"><div><h1>Support</h1><p>${user.role === 'admin' ? 'Requests from customers and agents.' : 'Requests about your bookings.'}</p></div></div>
    <div class="sorts">${[['open', 'Open'], ['closed', 'Resolved'], ['', 'All']].map(([v, l]) => html`<button data-s="${v}" aria-pressed="${v === status}">${l}</button>`)}</div><div id="list">${loading}</div>`);
  const load = async () => {
    const { tickets } = await api('/support', { query: { status } });
    const list = app.querySelector('#list');
    mount(list, table([
      { h: 'Request', v: (t) => html`<strong>${t.subject}</strong><div class="small muted">${t.requester}${t.booking_ref ? ` · ${t.booking_ref}` : ''}</div>` }, { h: 'Messages', r: true, v: (t) => t.messages },
      { h: 'Updated', v: (t) => when(t.updated_at) }, { h: 'Status', v: (t) => statusChip(t.status) },
    ], tickets, { onRow: true, empty: 'No requests' }));
    bindRows(list, tickets, (t) => thread(t.id, load));
  };
  app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { status = b.dataset.s; app.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); load(); }));
  load();
}
async function thread(id, refresh) {
  const d = drawer(loading);
  const draw = async () => {
    const { ticket, messages } = await api(`/support/${id}`);
    mount(d.el, html`<div class="row"><div><h2>${ticket.subject}</h2><p class="muted">${ticket.requester}${ticket.booking_ref ? ` · booking ${ticket.booking_ref}` : ''}</p></div><button class="link" id="x">Close</button></div>
      <div class="stack">${messages.map((m) => html`<div class="card" style="padding:12px"><strong>${m.author}</strong> <span class="chip plain">${m.author_role}</span> <span class="small muted">${when(m.created_at)}</span><p style="margin-top:6px">${m.body}</p></div>`)}</div>
      <form class="stack" novalidate>${field('Reply', 'body')}<div class="row"><button class="btn" type="submit">Send reply</button><button class="btn ghost" type="button" id="tog">${ticket.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></div></form>`);
    d.el.querySelector('#x').addEventListener('click', () => { d.close(); refresh(); });
    d.el.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); const v = e.target.elements.body.value.trim(); if (!v) return; await api(`/support/${id}/messages`, { method: 'POST', body: { body: v } }); draw(); });
    d.el.querySelector('#tog').addEventListener('click', async () => { await api(`/support/${id}`, { method: 'PATCH', body: { status: ticket.status === 'open' ? 'closed' : 'open' } }); d.close(); refresh(); });
  };
  draw();
}
void raw;

/* ============================== ADMIN: PROMOTIONS ============================== */
export async function promos({ app }) {
  mount(app, html`<div class="page-h"><div><h1>Promotions</h1><p>Promo codes customers can apply at checkout. Agents never get promo codes.</p></div><button class="btn" id="add">New promo code</button></div><div id="list">${loading}</div>`);
  const load = async () => {
    const { promos: rows } = await api('/admin/promos');
    const list = app.querySelector('#list');
    mount(list, table([
      { h: 'Code', v: (p) => html`<strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em">${p.code}</strong><div class="small muted">${p.description}</div>` },
      { h: 'Offer', v: (p) => (p.type === 'percent' ? `${p.value}% off` : `${money(p.value)} off`) + (p.max_discount ? ` (max ${money(p.max_discount)})` : '') },
      { h: 'For', v: (p) => (p.applies_to === 'all' ? 'Flights and hotels' : p.applies_to === 'flight' ? 'Flights' : 'Hotels') }, { h: 'Min spend', r: true, v: (p) => money(p.min_total) },
      { h: 'Used', r: true, v: (p) => `${p.used}${p.max_uses ? ` / ${p.max_uses}` : ''}` }, { h: 'Expires', v: (p) => p.expires_at || 'Never' },
      { h: 'Status', v: (p) => (p.active ? statusChip('active') : html`<span class="chip plain">Off</span>`) },
      { h: '', v: (p) => html`<button class="btn ghost sm" data-code="${p.code}" data-to="${p.active ? 0 : 1}">${p.active ? 'Turn off' : 'Turn on'}</button>` },
    ], rows, { empty: 'No promo codes yet' }));
    list.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', async () => { await api(`/admin/promos/${b.dataset.code}`, { method: 'PATCH', body: { active: b.dataset.to === '1' } }); toast('Updated'); load(); }));
  };
  app.querySelector('#add').addEventListener('click', () => {
    const m = modal(html`<div></div>`);
    mount(m.el, html`<div class="row"><h2>New promo code</h2><button class="link" data-x>Close</button></div>
      <form class="stack" novalidate>${field('Code', 'code', { placeholder: 'SUMMER15' })}${field('Description', 'description', { placeholder: '15% off summer trips' })}
        <div class="grid g2"><label class="field"><span>Type</span><select name="type"><option value="percent">Percent</option><option value="flat">Flat amount</option></select></label>${field('Value', 'value', { type: 'number', value: 10, attrs: 'min="1" step="1"' })}</div>
        <div class="grid g2">${field('Minimum spend', 'minTotal', { type: 'number', value: 3000, attrs: 'min="0" step="500"', required: false })}${field('Max discount', 'maxDiscount', { type: 'number', value: '', attrs: 'min="0" step="100"', required: false })}</div>
        <div class="grid g3"><label class="field"><span>For</span><select name="appliesTo"><option value="all">All</option><option value="flight">Flights</option><option value="hotel">Hotels</option></select></label>${field('Max uses', 'maxUses', { type: 'number', value: '', attrs: 'min="1"', required: false })}${field('Expires', 'expiresAt', { type: 'date', value: '', required: false })}</div>
        <button class="btn" type="submit">Create code</button></form>`);
    m.el.querySelector('[data-x]').addEventListener('click', m.close);
    const f = m.el.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
      const body = { code: v.code, description: v.description, type: v.type, value: Number(v.value), minTotal: Number(v.minTotal) || 0, appliesTo: v.appliesTo, maxDiscount: v.maxDiscount ? Number(v.maxDiscount) : null, maxUses: v.maxUses ? Number(v.maxUses) : null, expiresAt: v.expiresAt || null };
      try { await api('/admin/promos', { method: 'POST', body }); m.close(); toast('Promo code created'); load(); }
      catch (err) { setBusy(btn, false); if (!(err.fields && showErrors(f, err.fields))) toast(err.message); }
    });
  });
  load();
}
