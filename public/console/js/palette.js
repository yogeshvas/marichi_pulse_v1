import { api, html, mount, modal, typeIcon } from './kit.js';

/** Press Cmd+K or Ctrl+K anywhere in the console to jump to a page or find a booking. */
export function openPalette(user, pages) {
  const m = modal(html`<div></div>`);
  m.el.classList.add('palette');
  mount(m.el, html`<input id="pq" placeholder="Search pages, booking references, customers…" autocomplete="off" aria-label="Search"><div class="res" id="res"></div>`);
  const input = m.el.querySelector('#pq'), res = m.el.querySelector('#res');
  let seq = 0, items = [], sel = 0;
  const draw = () => {
    mount(res, items.length ? html`${items.map((it, i) => html`<a href="${it.href}" class="${i === sel ? 'on' : ''}" data-i="${i}"><span aria-hidden="true">${it.icon}</span><span>${it.label}</span><small>${it.hint || ''}</small></a>`)}` : html`<p class="muted" style="padding:14px">No matches</p>`);
    res.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => m.close()));
  };
  const run = async () => {
    const q = input.value.trim().toLowerCase(); const mine = ++seq;
    items = pages.filter((p) => !q || p.label.toLowerCase().includes(q)).map((p) => ({ icon: p.icon, label: p.label, hint: 'Page', href: `#/${p.key}` }));
    draw();
    if (q.length >= 2) {
      try {
        const [b, c] = await Promise.all([api('/bookings/manage', { query: { q, pageSize: 5 } }), user.role === 'agent' ? api('/agent/customers', { query: { q } }) : Promise.resolve({ customers: [] })]);
        if (mine !== seq) return;
        items = [...items,
          ...b.rows.map((r) => ({ icon: typeIcon(r.type), label: `${r.ref} · ${r.summary.title}`, hint: r.customerName, href: `#/bookings?open=${r.ref}` })),
          ...c.customers.slice(0, 4).map((x) => ({ icon: '☺', label: x.name, hint: 'Customer', href: `#/customers?open=${x.id}` }))];
        sel = 0; draw();
      } catch { /* ignore */ }
    }
  };
  input.addEventListener('input', () => { sel = 0; run(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { location.hash = items[sel].href; m.close(); }
  });
  run(); input.focus();
}
