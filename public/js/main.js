import { api, session } from './api.js';
import { html, mount, initAutocomplete } from './ui.js';
import { renderAccount } from './auth.js';
import { home, flightResults, hotelResults } from './views/search.js';
import { flightCheckout, hotelCheckout } from './views/checkout.js';
import { trips, tripDetail } from './views/trips.js';
import { account } from './views/account.js';
import { planner } from './views/planner.js';
import { initAssistant } from './assistant.js';

const routes = [
  [/^$/, home, 'flights'],
  [/^flights$/, flightResults, 'flights'],
  [/^hotels$/, hotelResults, 'hotels'],
  [/^checkout\/flight\/(.+)$/, flightCheckout, 'flights'],
  [/^checkout\/hotel\/(.+)$/, hotelCheckout, 'hotels'],
  [/^trips$/, trips, 'trips'],
  [/^trips\/([^/?]+)$/, tripDetail, 'trips'],
  [/^account$/, account, 'account'],
  [/^planner$/, planner, 'planner'],
];

let nav = 0;
async function route() {
  const mine = ++nav;
  const [path, qs = ''] = (location.hash.slice(1) || '/').split('?');
  const p = path.replace(/^\/+/, '');
  const query = Object.fromEntries(new URLSearchParams(qs));

  // Fresh container each time so old event listeners do not pile up.
  const old = document.getElementById('app');
  const app = old.cloneNode(false);
  old.replaceWith(app);

  const hit = routes.map(([re, fn, tab]) => [re.exec(p), fn, tab]).find(([m]) => m);
  if (!hit) { mount(app, html`<div class="card empty"><h2>Page not found</h2><a class="btn" href="#/">Go home</a></div>`); return; }
  const [m, fn, tab] = hit;
  const activeTab = tab === 'flights' && query.tab === 'hotels' ? 'hotels' : tab;
  document.body.dataset.mode = activeTab === 'hotels' ? 'hotel' : 'flight';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === activeTab));
  scrollTo(0, 0);
  try { await fn({ query, params: m.slice(1), app }); }
  catch (e) { console.error(e); if (mine === nav) mount(app, html`<div class="card empty"><h2>Something went wrong</h2><p class="muted">Please try again.</p><a class="btn" href="#/">Go home</a></div>`); }
  app.focus({ preventScroll: true });
}

initAutocomplete();
initAssistant();
renderAccount(document.getElementById('account'));
window.addEventListener('session', () => renderAccount(document.getElementById('account')));
window.addEventListener('hashchange', route);
api('/config').then((c) => { document.getElementById('demo-banner').hidden = c.mode !== 'demo'; }).catch(() => {});
route();
void session;
