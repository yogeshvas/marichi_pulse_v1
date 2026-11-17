import { api, session } from './api.js';
import { html, mount, modal, field, showErrors, setBusy, toast } from './ui.js';

/** Resolves true when signed in, false if the person closes the dialog. */
export function requireLogin(reason = 'Sign in to finish your booking') {
  if (session.get()) return Promise.resolve(true);
  return new Promise(async (resolve) => {
    let mode = 'login', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal(html`<div></div>`, { onClose: () => finish(false) });
    const demo = await api('/config').then((c) => c.mode === 'demo').catch(() => false);
    const draw = (error = '') => {
      mount(m.el, html`
        <div class="row"><h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2><button class="link" data-x aria-label="Close">Close</button></div>
        <p class="muted small">${reason}</p>
        ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
        <form class="stack" novalidate>
          ${mode === 'register' ? field('Full name', 'name', { attrs: 'autocomplete="name"' }) : ''}
          ${field('Email', 'email', { type: 'email', attrs: 'autocomplete="email"' })}
          ${field('Password', 'password', { type: 'password', attrs: `autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8"` })}
          <button class="btn" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        ${demo && mode === 'login' ? html`<button type="button" class="btn ghost" data-demo style="justify-content:flex-start"><span><strong>Demo customer</strong> <span class="small muted" style="font-weight:400">Click to sign in</span></span></button>` : ''}
        <p class="small muted">${mode === 'login' ? 'New here?' : 'Already have an account?'} <button class="link" data-switch>${mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>`);
      m.el.querySelector('[data-x]').addEventListener('click', m.close);
      m.el.querySelector('[data-switch]').addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; draw(); });
      m.el.querySelector('[data-demo]')?.addEventListener('click', async () => {
        try { const r = await api('/auth/login', { method: 'POST', body: { email: 'customer@skyline.test', password: 'Customer@12345' } }); session.set(r); finish(true); m.close(); toast('Signed in as the demo customer'); }
        catch (err) { draw(err.message); }
      });
      const form = m.el.querySelector('form');
      form.elements.email.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        const body = Object.fromEntries(new FormData(form));
        setBusy(btn, true);
        try {
          const r = await api(`/auth/${mode}`, { method: 'POST', body });
          session.set(r);
          finish(true); m.close();
          toast(`Welcome, ${r.user.name.split(' ')[0]}`);
        } catch (err) {
          setBusy(btn, false);
          if (err.fields && showErrors(form, err.fields)) return;
          draw(err.message);
        }
      });
    };
    draw();
  });
}

export function renderAccount(el) {
  const s = session.get();
  if (!s) {
    mount(el, html`<button class="btn sm" id="signin">Sign in</button>`);
    el.querySelector('#signin').addEventListener('click', () => requireLogin('Sign in to see your trips and book faster.'));
  } else {
    const staff = ['agent', 'admin'].includes(s.user.role);
    mount(el, html`${staff ? html`<a class="btn sm" href="/console/" style="margin-right:8px">${s.user.role === 'admin' ? 'Admin' : 'Agent'} portal</a>` : ''}<a class="small" href="#/account" style="margin-right:10px;text-decoration:none">${s.user.name}</a><button class="btn ghost sm" id="signout">Sign out</button>`);
    el.querySelector('#signout').addEventListener('click', () => { session.clear(); toast('Signed out'); location.hash = '#/'; });
  }
}
