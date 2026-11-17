import { api } from './api.js';

/* ---- safe templating: every interpolated value is escaped unless wrapped in raw() ---- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const raw = (s) => ({ __raw: String(s) });
const val = (v) => (Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : typeof v === 'object' && '__raw' in v ? v.__raw : esc(v));
export const html = (strings, ...vals) => ({ __raw: strings.reduce((o, s, i) => o + s + (i < vals.length ? val(vals[i]) : ''), '') });
export const mount = (el, h) => { el.innerHTML = h.__raw; };

/* ---- formatting ---- */
export const money = (n, cur = 'ZMW') => (cur === 'ZMW' ? `K${Math.round(n).toLocaleString('en-GB')}` : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n));
export const hhmm = (iso) => iso.slice(11, 16);
export const dayLabel = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const longDate = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dur = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
export const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
export const plusDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const today = () => plusDays(0);
export const stopsLabel = (it) => (it.segments.length === 1 ? 'Non-stop' : `${it.segments.length - 1} stop${it.segments.length > 2 ? 's' : ''} · via ${it.segments.slice(0, -1).map((s) => s.to).join(', ')}`);
export const cabinLabel = (c) => ({ ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business', FIRST: 'First' }[c] || c);
export const starsText = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

/* ---- feedback ---- */
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

export function modal(content, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  mount(root, html`<div class="modal-bg" data-close-bg><div class="modal" role="dialog" aria-modal="true">${content}</div></div>`);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-close-bg]').addEventListener('mousedown', (e) => { if (e.target.dataset.closeBg !== undefined) close(); });
  root.querySelector('input,button,select')?.focus();
  return { el: root.querySelector('.modal'), close };
}

/* ---- forms ---- */
export function showErrors(root, fields = {}) {
  root.querySelectorAll('.field.err').forEach((f) => { f.classList.remove('err'); f.querySelector('.msg')?.remove(); });
  let first = null;
  for (const [path, msg] of Object.entries(fields)) {
    const input = root.querySelector(`[name="${CSS.escape(path)}"]`);
    const field = input?.closest('.field');
    if (!field) continue;
    field.classList.add('err');
    field.insertAdjacentHTML('beforeend', `<span class="msg">${esc(msg)}</span>`);
    first ??= input;
  }
  first?.focus();
  return Boolean(first);
}
export const field = (label, name, { value = '', type = 'text', attrs = '', ac = '', placeholder = '', required = true } = {}) =>
  html`<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${value}" placeholder="${placeholder}" ${raw(attrs)} ${ac ? raw(`data-ac="${ac}" autocomplete="off" role="combobox"`) : ''} ${required ? raw('required') : ''}></label>`;

export function setBusy(btn, busy, label) {
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + (label ? ` ${esc(label)}` : ''); }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.label || btn.innerHTML; }
}

/* ---- place autocomplete (airports and cities, from Amadeus) ---- */
export function placeValue(el) {
  if (el.dataset.code) return el.dataset.code;
  const m = /\(([A-Za-z]{3})\)\s*$/.exec(el.value) || /^([A-Za-z]{3})$/.exec(el.value.trim());
  return m ? m[1].toUpperCase() : '';
}
export const setPlace = (el, code, label) => { el.value = `${label} (${code})`; el.dataset.code = code; };

export function initAutocomplete() {
  let timer, seq = 0;
  const close = () => document.querySelectorAll('.ac-list').forEach((n) => n.remove());
  document.addEventListener('input', (e) => {
    const el = e.target.closest?.('[data-ac]');
    if (!el) return;
    el.dataset.code = '';
    clearTimeout(timer);
    const q = el.value.trim();
    if (q.length < 2) return close();
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const { items } = await api('/locations', { query: { q, type: el.dataset.ac } });
        if (mine !== seq) return;
        close();
        if (!items.length) return;
        el.closest('.field').insertAdjacentHTML('beforeend', `<div class="ac-list" role="listbox">${items.map((i) =>
          `<button type="button" role="option" data-code="${esc(i.code)}" data-label="${esc(i.type === 'airport' ? i.city || i.name : i.name)}"><b>${esc(i.code)}</b><span>${esc(i.name)}${i.city && i.type === 'airport' ? ' · ' + esc(i.city) : ''} <span class="muted small">${esc(i.country)}</span></span></button>`).join('')}</div>`);
      } catch { /* suggestions are optional */ }
    }, 220);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.ac-list button');
    if (b) {
      const input = b.closest('.field').querySelector('[data-ac]');
      setPlace(input, b.dataset.code, b.dataset.label);
      close();
      input.focus();
    } else if (!e.target.closest?.('[data-ac]')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
