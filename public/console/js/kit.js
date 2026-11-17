import { api, session } from '/js/api.js';
import { html, raw, mount, modal, money, toast, field } from '/js/ui.js';

export { html, raw, mount, modal, money, toast, field, api, session };
export const num = (n) => Number(n || 0).toLocaleString('en-GB');
export const pctText = (n) => `${Number(n || 0).toFixed(1)}%`;
export const when = (s) => (s || '').slice(0, 16).replace('T', ' ');
export const day = (s) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const iso = (d) => d.toISOString().slice(0, 10);
export const ago = (n) => iso(new Date(Date.now() - n * 864e5));

export const kpi = (label, value, sub = '', change = '') => html`<div class="card kpi"><small>${label}</small><b>${value}</b>${change}<span>${sub}</span></div>`;
/** Change against the previous period of the same length. invert: lower is better. */
export function delta(cur, prev, { invert = false } = {}) {
  if (prev == null) return '';
  if (!prev) return cur ? html`<span class="delta up">New</span>` : '';
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return html`<span class="delta flat">▬ No change</span>`;
  const good = invert ? pct < 0 : pct > 0;
  return html`<span class="delta ${good ? 'up' : 'down'}" title="Compared with the previous period">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(pct > 99 ? 0 : 1)}%</span>`;
}
export const statusChip = (s) => ({ confirmed: html`<span class="chip good">Confirmed</span>`, cancelled: html`<span class="chip bad">Cancelled</span>`, cancellation_requested: html`<span class="chip warn">Cancel requested</span>`, active: html`<span class="chip good">Active</span>`, pending: html`<span class="chip warn">Pending</span>`, suspended: html`<span class="chip bad">Suspended</span>`, open: html`<span class="chip warn">Open</span>`, closed: html`<span class="chip plain">Closed</span>` }[s] || html`<span class="chip plain">${s}</span>`);
export const typeIcon = (t) => (t === 'flight' ? '✈' : '🏨');

/** Downloads a CSV from an authenticated endpoint. */
export async function downloadCsv(path, query) {
  const url = new URL(`/api${path}`, location.origin);
  for (const [k, v] of Object.entries({ ...query, format: 'csv' })) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { authorization: `Bearer ${session.get().token}` } });
  if (!res.ok) return toast('Could not export');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

/** Date range and type bar. Calls onChange(query) when anything changes. */
export function rangeBar(root, state, onChange, { types = true, extra = '' } = {}) {
  const presets = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
  mount(root, html`<div class="toolbar">
    <div class="sorts" role="group" aria-label="Range">${presets.map(([d, l]) => html`<button type="button" data-p="${d}" aria-pressed="${state.preset === d}">${l}</button>`)}</div>
    <label class="field"><span>From</span><input type="date" name="from" value="${state.from}"></label>
    <label class="field"><span>To</span><input type="date" name="to" value="${state.to}"></label>
    ${types ? html`<label class="field"><span>Product</span><select name="type"><option value="">All</option><option value="flight" ${state.type === 'flight' ? raw('selected') : ''}>Flights</option><option value="hotel" ${state.type === 'hotel' ? raw('selected') : ''}>Hotels</option></select></label>` : ''}
    ${raw(extra)}</div>`);
  const push = () => onChange({ ...state });
  root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { state.preset = b.dataset.p; state.from = ago(Number(b.dataset.p) - 1); state.to = iso(new Date()); rangeBar(root, state, onChange, { types, extra }); push(); }));
  root.querySelectorAll('input[type=date],select').forEach((i) => i.addEventListener('change', () => { state[i.name] = i.value; if (i.type === 'date') state.preset = ''; if (i.type === 'date') root.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', false)); push(); }));
}
export const newRange = () => ({ preset: '30', from: ago(29), to: iso(new Date()), type: '' });

export function table(cols, rows, { onRow, empty = 'Nothing to show' } = {}) {
  if (!rows.length) return html`<div class="card empty"><p class="muted">${empty}</p></div>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => html`<th class="${c.r ? 'r' : ''}">${c.h}</th>`)}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr class="${onRow ? 'click' : ''}" data-row="${i}" ${onRow ? raw('tabindex="0"') : ''}>${cols.map((c) => html`<td class="${c.r ? 'r' : ''}">${c.v(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}
export function bindRows(root, rows, fn) {
  root.querySelectorAll('tr[data-row]').forEach((tr) => {
    const go = () => fn(rows[Number(tr.dataset.row)]);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
export const pager = (page, size, total) => html`<div class="pager"><span>${total ? `${(page - 1) * size + 1} to ${Math.min(page * size, total)} of ${num(total)}` : '0 results'}</span>
  <span><button class="btn ghost sm" data-pg="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>Previous</button> <button class="btn ghost sm" data-pg="${page + 1}" ${page * size >= total ? raw('disabled') : ''}>Next</button></span></div>`;

export function drawer(content) {
  const root = document.getElementById('modal-root');
  mount(root, html`<div class="drawer-bg" data-bg><aside class="drawer" role="dialog" aria-modal="true">${content}</aside></div>`);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  root.querySelector('[data-bg]').addEventListener('mousedown', (e) => { if (e.target.dataset.bg !== undefined) close(); });
  return { el: root.querySelector('.drawer'), close };
}
export const loading = html`<div class="skeleton"></div>`;
