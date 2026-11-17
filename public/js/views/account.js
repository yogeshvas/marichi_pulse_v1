import { api, session } from '../api.js';
import { html, raw, mount, field, showErrors, setBusy, toast, dayLabel, money } from '../ui.js';
import { requireLogin } from '../auth.js';

export async function account({ query, app }) {
  document.title = 'My account · Marichi Pulse';
  if (!(await requireLogin('Sign in to manage your account.'))) {
    return mount(app, html`<div class="card empty"><h2>Sign in to see your account</h2><a class="btn" href="#/">Go home</a></div>`);
  }
  const user = session.get().user;
  const draw = async () => {
    const [{ travellers }, { tickets }, { bookings }, rewards] = await Promise.all([api('/account/travellers'), api('/support'), api('/bookings'), api('/account/rewards')]);
    const pct = rewards.tier.next ? Math.min(100, Math.round((rewards.lifetime / rewards.tier.at) * 100)) : 100;
    mount(app, html`
      <div class="rhead"><h1>My account</h1>${['agent', 'admin'].includes(user.role) ? html`<a class="btn sm" href="/console/">Open ${user.role} portal</a>` : ''}</div>
      ${user.role === 'customer' ? html`<section class="tier" style="margin-bottom:18px"><div class="row"><span style="font-weight:600;letter-spacing:.06em">PULSE POINTS · ${rewards.tier.name.toUpperCase()}</span><span class="chip" style="background:#ffffff30;color:#fff">1 point per K100</span></div>
        <div class="pts">${rewards.points.toLocaleString('en-GB')}</div><div class="small" style="opacity:.9">Worth ${money(rewards.points)} off your next trip. Use up to 10% of a booking.</div>
        <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div><div class="small" style="opacity:.9">${rewards.tier.next ? `${(rewards.tier.at - rewards.lifetime).toLocaleString('en-GB')} more points to reach ${rewards.tier.next}` : 'You are at the top tier'}</div>
        ${rewards.history.length ? html`<details style="opacity:.95"><summary style="cursor:pointer;font-weight:600">Recent activity</summary><div class="stack" style="margin-top:8px">${rewards.history.slice(0, 6).map((h) => html`<div class="row small"><span>${h.created_at.slice(0, 10)} · ${h.note || h.type}${h.booking_ref ? ` · ${h.booking_ref}` : ''}</span><b>${h.points > 0 ? '+' : ''}${h.points}</b></div>`)}</div></details>` : ''}</section>` : ''}
      <div class="grid g2" style="align-items:start">
        <form class="card stack" id="profile" novalidate><h2>Profile</h2>
          ${field('Full name', 'name', { value: user.name })}
          <label class="field"><span>Email</span><input value="${user.email}" disabled></label>
          ${field('Mobile number', 'phone', { value: user.phone || '', placeholder: '+260971234567', required: false })}
          <button class="btn" type="submit" style="justify-self:start">Save profile</button></form>
        <div class="card stack"><div class="row"><h2>Saved travellers</h2><button class="btn ghost sm" id="addtrav">Add traveller</button></div>
          <p class="small muted">Saved names fill in at checkout. Passport numbers are never stored here.</p>
          ${travellers.length ? travellers.map((t) => html`<div class="row"><span>${t.firstName} ${t.lastName} <span class="muted small">· born ${t.dob}</span></span><button class="link" data-deltrav="${t.id}">Remove</button></div>`) : html`<p class="muted">No saved travellers yet.</p>`}
          <form id="travform" class="stack" hidden novalidate>
            <div class="grid g2">${field('First name', 'firstName')}${field('Last name', 'lastName')}</div>
            <div class="grid g2">${field('Date of birth', 'dob', { type: 'date' })}<label class="field"><span>Gender</span><select name="gender"><option value="M">Male</option><option value="F">Female</option></select></label></div>
            <button class="btn sm" type="submit" style="justify-self:start">Save traveller</button></form></div>
      </div>
      <section class="card stack" style="margin-top:18px" id="support"><div class="row"><h2>Support</h2><button class="btn ghost sm" id="newticket">New request</button></div>
        <form id="ticketform" class="stack" hidden novalidate>
          ${field('Subject', 'subject', { placeholder: 'What do you need help with?' })}
          <label class="field"><span>Booking (optional)</span><select name="bookingRef"><option value="">Not about a booking</option>${bookings.map((b) => html`<option value="${b.ref}" ${query.ticket === b.ref ? raw('selected') : ''}>${b.ref} · ${b.summary.title}</option>`)}</select></label>
          <label class="field"><span>Message</span><textarea name="message" rows="4" style="border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface)"></textarea></label>
          <button class="btn" type="submit" style="justify-self:start">Send request</button></form>
        <div id="tickets" class="stack">${tickets.length ? tickets.map((t) => html`<button class="card trip" style="grid-template-columns:minmax(0,1fr) auto;text-align:left" data-ticket="${t.id}"><div><strong>${t.subject}</strong><div class="small muted">${t.booking_ref ? `Booking ${t.booking_ref} · ` : ''}Updated ${t.updated_at.slice(0, 10)} · ${t.messages} message${t.messages > 1 ? 's' : ''}</div></div><span class="chip ${t.status === 'open' ? 'warn' : 'plain'}">${t.status}</span></button>`) : html`<p class="muted">No support requests.</p>`}</div>
        <div id="thread"></div></section>`);

    const pf = app.querySelector('#profile');
    pf.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = pf.querySelector('[type=submit]'); setBusy(btn, true);
      try { const r = await api('/account/profile', { method: 'PUT', body: { name: pf.elements.name.value, phone: pf.elements.phone.value } }); session.set({ ...session.get(), user: { ...user, ...r.user } }); toast('Profile saved'); }
      catch (err) { if (!(err.fields && showErrors(pf, err.fields))) toast(err.message); }
      setBusy(btn, false);
    });
    app.querySelector('#addtrav').addEventListener('click', () => { const f = app.querySelector('#travform'); f.hidden = !f.hidden; });
    app.querySelector('#travform').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target.elements;
      try { await api('/account/travellers', { method: 'POST', body: { firstName: f.firstName.value, lastName: f.lastName.value, dob: f.dob.value, gender: f.gender.value } }); toast('Traveller saved'); draw(); }
      catch (err) { if (!(err.fields && showErrors(e.target, err.fields))) toast(err.message); }
    });
    app.querySelectorAll('[data-deltrav]').forEach((b) => b.addEventListener('click', async () => { await api(`/account/travellers/${b.dataset.deltrav}`, { method: 'DELETE' }); draw(); }));

    const tf = app.querySelector('#ticketform');
    app.querySelector('#newticket').addEventListener('click', () => { tf.hidden = !tf.hidden; });
    if (query.ticket) tf.hidden = false;
    tf.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = tf.elements;
      try { await api('/support', { method: 'POST', body: { subject: f.subject.value, message: f.message.value, ...(f.bookingRef.value ? { bookingRef: f.bookingRef.value } : {}) } }); toast('Request sent'); draw(); }
      catch (err) { if (!(err.fields && showErrors(tf, err.fields))) toast(err.message); }
    });
    app.querySelectorAll('[data-ticket]').forEach((b) => b.addEventListener('click', () => openThread(app, b.dataset.ticket, draw)));
  };
  draw();
}

async function openThread(app, id, refresh) {
  const box = app.querySelector('#thread');
  const { ticket, messages } = await api(`/support/${id}`);
  mount(box, html`<div class="card stack" style="background:var(--soft)"><div class="row"><h3>${ticket.subject}</h3><span class="chip ${ticket.status === 'open' ? 'warn' : 'plain'}">${ticket.status}</span></div>
    ${messages.map((m) => html`<div><strong>${m.author}</strong> <span class="chip plain">${m.author_role}</span> <span class="small muted">${m.created_at.slice(0, 16)}</span><p>${m.body}</p></div>`)}
    <form class="stack" novalidate><label class="field"><span>Reply</span><input name="body"></label>
      <div class="row"><button class="btn sm" type="submit">Send reply</button><button class="btn ghost sm" type="button" data-toggle>${ticket.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></div></form></div>`);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const f = box.querySelector('form');
  f.addEventListener('submit', async (e) => { e.preventDefault(); if (!f.elements.body.value.trim()) return; await api(`/support/${id}/messages`, { method: 'POST', body: { body: f.elements.body.value } }); openThread(app, id, refresh); });
  box.querySelector('[data-toggle]').addEventListener('click', async () => { await api(`/support/${id}`, { method: 'PATCH', body: { status: ticket.status === 'open' ? 'closed' : 'open' } }); refresh(); });
}
void dayLabel;
