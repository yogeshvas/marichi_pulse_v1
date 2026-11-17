import { api, session, html, raw, mount, toast, field } from './kit.js';
import { showErrors, setBusy } from '/js/ui.js';
import { dashboard, bookings, reports } from './pages1.js';
import { newBooking, customers, wallet, profile } from './pages2.js';
import { agents, users, settings, auditLog, supportPage, promos } from './pages3.js';
import { openPalette } from './palette.js';

const NAV = {
  agent: [['', 'Dashboard', '▦'], ['new', 'New booking', '＋'], ['bookings', 'Bookings', '☰'], ['customers', 'Customers', '☺'], ['wallet', 'Wallet', 'K'], ['reports', 'Reports', '▤'], ['support', 'Support', '?'], ['profile', 'Profile', '⚙']],
  admin: [['', 'Overview', '▦'], ['bookings', 'Bookings', '☰'], ['agents', 'Agents', '☺'], ['users', 'Users', '◎'], ['reports', 'Reports', '▤'], ['promos', 'Promotions', '%'], ['support', 'Support', '?'], ['settings', 'Pricing and settings', '⚙'], ['audit', 'Audit log', '✎']],
};
const PAGES = {
  agent: { '': dashboard, new: newBooking, bookings, customers, wallet, reports, support: supportPage, profile },
  admin: { '': dashboard, bookings, agents, users, reports, promos, support: supportPage, settings, audit: auditLog },
};

const root = document.getElementById('root');

const DEMO = [
  { label: 'Admin', sub: 'Analytics, agents, pricing', email: 'admin@skyline.test', password: 'Admin@12345' },
  { label: 'Agent', sub: 'Bookings, customers, wallet', email: 'agent@skyline.test', password: 'Agent@12345' },
];

async function loginScreen(message = '') {
  let mode = 'login';
  const demo = await api('/config').then((c) => c.mode === 'demo').catch(() => false);
  const draw = (error = message) => {
    mount(root, html`<div class="login-wrap"><div class="card login-card">
      <div><a class="brand" href="/" aria-label="Marichi Pulse"><img class="brand-logo" src="/img/logo.jpg" alt="Marichi Pulse by Marichi Labs" width="135" height="44"></a></div><span class="chip plain" style="justify-self:start">Console</span>
      <h2>${mode === 'login' ? 'Sign in to the console' : 'Become an agent'}</h2>
      <p class="muted small">${mode === 'login' ? 'For travel agents and platform administrators.' : 'Apply for an agent account. An administrator reviews every request.'}</p>
      ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
      <form class="stack" novalidate>
        ${mode === 'register' ? html`${field('Agency name', 'agency')}${field('Your name', 'name')}${field('Mobile number', 'phone', { placeholder: '+260971234567' })}` : ''}
        ${field('Email', 'email', { type: 'email', attrs: 'autocomplete="email"' })}${field('Password', 'password', { type: 'password', attrs: `autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"` })}
        <button class="btn" type="submit">${mode === 'login' ? 'Sign in' : 'Send application'}</button></form>
      <p class="small muted">${mode === 'login' ? 'Not an agent yet?' : 'Already approved?'} <button class="link" id="sw">${mode === 'login' ? 'Apply to become one' : 'Sign in'}</button> · <a href="/">Customer site</a></p>
      ${mode === 'login' && demo ? html`<div class="stack" style="border-top:1px solid var(--line);padding-top:14px"><span class="small muted">Demo mode: click to sign in</span>
        <div class="grid g2">${DEMO.map((d, i) => html`<button type="button" class="btn ghost" data-demo="${i}" style="flex-direction:column;align-items:flex-start;gap:0;text-align:left"><strong>${d.label}</strong><span class="small muted" style="font-weight:400">${d.sub}</span></button>`)}</div></div>` : ''}
    </div></div>`);
    root.querySelector('#sw').addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; draw(''); });
    const f = root.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = f.querySelector('[type=submit]'); setBusy(btn, true);
      try {
        const r = await api(mode === 'login' ? '/auth/login' : '/auth/register-agent', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
        session.set(r); boot();
      } catch (err) { setBusy(btn, false); if (err.fields && showErrors(f, err.fields)) return; draw(err.message); }
    });
    root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
      const d = DEMO[Number(b.dataset.demo)]; setBusy(b, true);
      try { session.set(await api('/auth/login', { method: 'POST', body: { email: d.email, password: d.password } })); boot(); }
      catch (err) { setBusy(b, false); draw(err.message); }
    }));
  };
  draw();
}

function notStaff(user) {
  mount(root, html`<div class="login-wrap"><div class="card login-card"><h2>This area is for agents and admins</h2><p class="muted">You are signed in as ${user.name}, a customer account.</p>
    <a class="btn" href="/">Go to the customer site</a><button class="btn ghost" id="out">Sign out</button></div></div>`);
  root.querySelector('#out').addEventListener('click', () => { session.clear(); boot(); });
}
function pending(user) {
  mount(root, html`<div class="login-wrap"><div class="card login-card"><h2>Application received</h2><p class="muted">Thanks ${user.name.split(' ')[0]}. An administrator will review your agency soon. You will be able to sign in once it is approved.</p>
    <button class="btn ghost" id="out">Sign out</button></div></div>`);
  root.querySelector('#out').addEventListener('click', () => { session.clear(); boot(); });
}

let nav = 0;
async function renderPage(user) {
  const mine = ++nav;
  const [path, qs = ''] = (location.hash.slice(1) || '/').split('?');
  const key = path.replace(/^\/+/, '').split('/')[0];
  const pages = PAGES[user.role];
  const fn = pages[key] || pages[''];
  document.querySelectorAll('.side-nav a.nav').forEach((a) => a.classList.toggle('on', a.dataset.k === (pages[key] ? key : '')));
  const old = document.getElementById('page');
  const app = old.cloneNode(false);
  old.replaceWith(app);
  scrollTo(0, 0);
  try { await fn({ app, user, query: Object.fromEntries(new URLSearchParams(qs)) }); }
  catch (e) {
    if (mine !== nav) return;
    if (e.status === 401 || e.status === 403) { session.clear(); return boot(e.message); }
    console.error(e);
    mount(app, html`<div class="card empty"><h2>Could not load this page</h2><p class="muted">${e.message || 'Please try again.'}</p></div>`);
  }
}

async function boot(message = '') {
  const s = session.get();
  if (!s) return loginScreen(message);
  let user;
  try { user = (await api('/auth/me')).user; } catch { session.clear(); return loginScreen(message); }
  if (!['agent', 'admin'].includes(user.role)) return notStaff(user);
  if (user.role === 'agent' && user.agentStatus !== 'active') return pending(user);

  let badge = 0;
  if (user.role === 'admin') { try { badge = (await api('/admin/system')).counts.pendingAgents; } catch { /* optional */ } }
  mount(root, html`<div class="shell"><nav class="side-nav" aria-label="Console"><a class="brand" href="#/" aria-label="Marichi Pulse"><img class="brand-logo" src="/img/logo.jpg" alt="Marichi Pulse by Marichi Labs" width="135" height="44"></a>
    <button class="searchbtn" id="cmdk" type="button"><span>Search…</span><span class="kbd">⌘K</span></button>
    <div class="grp">${user.role === 'admin' ? 'Administration' : 'Agent portal'}</div>
    ${NAV[user.role].map(([k, label, icon]) => html`<a class="nav" data-k="${k}" href="#/${k}"><span aria-hidden="true" style="width:18px;text-align:center">${icon}</span>${label}${k === 'agents' && badge ? html`<span class="badge">${badge}</span>` : ''}</a>`)}
    <div class="who"><div><strong>${user.name}</strong><div class="muted">${user.role === 'admin' ? 'Administrator' : 'Travel agent'}</div></div><a href="/">Customer site</a><button class="link" id="out" style="text-align:left">Sign out</button></div></nav>
    <main class="main" id="page"></main></div>`);
  root.querySelector('#out').addEventListener('click', () => { session.clear(); toast('Signed out'); boot(); });
  const pages = NAV[user.role].map(([key, label, icon]) => ({ key, label, icon }));
  root.querySelector('#cmdk').addEventListener('click', () => openPalette(user, pages));
  window.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(user, pages); } };
  window.onhashchange = () => renderPage(user);
  renderPage(user);
}
boot();
void raw;
