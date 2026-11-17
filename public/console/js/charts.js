// Small chart kit: SVG line/column charts with hover, HTML bars, donut. One axis per chart.
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const compact = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const dayText = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function frame(el, W, H, m) {
  el.innerHTML = `<div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img"></svg><div class="tip" hidden></div></div>`;
  return { svg: el.querySelector('svg'), tip: el.querySelector('.tip'), plot: el.querySelector('.plot'), W, H, m };
}
function axes(f, max, fmt, labels) {
  const { svg, W, H, m } = f;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ((H - m.t - m.b) * (4 - i)) / 4;
    g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${fmt((max * i) / 4)}</text>`;
  }
  const n = labels.length, step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => {
    if (i % step === 0 || i === n - 1) {
      const x = m.l + ((W - m.l - m.r) * (n === 1 ? 0.5 : i / (n - 1)));
      if (i === n - 1 && i % step !== 0 && n - 1 - (i - (i % step)) < step * 0.6) return;
      g += `<text x="${x}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
    }
  });
  svg.insertAdjacentHTML('beforeend', g);
}
function hover(f, count, xOf, show) {
  const { svg, tip, plot, W, H, m } = f;
  const cross = document.createElementNS(NS, 'line');
  cross.setAttribute('y1', m.t); cross.setAttribute('y2', H - m.b); cross.setAttribute('stroke', 'var(--muted)'); cross.setAttribute('stroke-dasharray', '3 3'); cross.setAttribute('visibility', 'hidden');
  svg.appendChild(cross);
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', 4.5); dot.setAttribute('stroke', 'var(--surface)'); dot.setAttribute('stroke-width', 2); dot.setAttribute('visibility', 'hidden');
  svg.appendChild(dot);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(count - 1, Math.round(((x - m.l) / (W - m.l - m.r)) * (count - 1))));
    const info = show(i);
    cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i)); cross.setAttribute('visibility', 'visible');
    if (info.y != null) { dot.setAttribute('cx', xOf(i)); dot.setAttribute('cy', info.y); dot.setAttribute('fill', info.color); dot.setAttribute('visibility', 'visible'); }
    tip.hidden = false; tip.innerHTML = info.html;
    const pr = plot.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(((xOf(i) / W) * r.width) + (r.left - pr.left), 60), pr.width - 60)}px`;
    tip.style.top = `${(((info.y ?? m.t) / H) * r.height) + (r.top - pr.top)}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}

export function lineChart(el, { dates, values, color = 'var(--s1)', fmt = compact, name = 'Value', label = fmt, forecast }) {
  const W = 640, H = 230, m = { l: 46, r: 12, t: 12, b: 28 };
  const f = frame(el, W, H, m);
  const fc = forecast?.length ? forecast : [];
  const all = [...dates, ...fc.map((d) => d.date)];
  const max = niceMax(Math.max(...values, ...fc.map((d) => d.sales), 0));
  axes(f, max, fmt, all.map(dayText));
  const n = all.length;
  const x = (i) => m.l + ((W - m.l - m.r) * (n === 1 ? 0.5 : i / (n - 1)));
  const y = (v) => m.t + (H - m.t - m.b) * (1 - v / max);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  let g = `<polygon points="${x(0)},${H - m.b} ${pts} ${x(values.length - 1)},${H - m.b}" fill="${color}" opacity=".12"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (fc.length) {
    const fp = [`${x(values.length - 1)},${y(values.at(-1))}`, ...fc.map((d, i) => `${x(values.length + i)},${y(d.sales)}`)].join(' ');
    g += `<rect x="${x(values.length - 1)}" y="${m.t}" width="${W - m.r - x(values.length - 1)}" height="${H - m.t - m.b}" fill="${color}" opacity=".05"/><polyline points="${fp}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`;
  }
  f.svg.insertAdjacentHTML('beforeend', g);
  hover(f, n, x, (i) => {
    const isF = i >= values.length;
    const v = isF ? fc[i - values.length].sales : values[i];
    return { y: y(v), color, html: `${dayText(all[i])}${isF ? ' · forecast' : ''}<br>${esc(name)}: <b>${label(v)}</b>` };
  });
  f.svg.setAttribute('aria-label', `${name} over time${fc.length ? ' with a 14 day forecast' : ''}`);
}

export function columns(el, { labels, values, color = 'var(--s1)', fmt = compact, name = 'Value', tickLabels }) {
  const W = 640, H = 230, m = { l: 40, r: 8, t: 12, b: 28 };
  const f = frame(el, W, H, m);
  const max = niceMax(Math.max(...values, 0));
  const n = values.length, slot = (W - m.l - m.r) / n, bw = Math.min(26, slot - 4);
  axes(f, max, fmt, []);
  let g = '';
  values.forEach((v, i) => {
    const h = (H - m.t - m.b) * (v / max), x = m.l + slot * i + (slot - bw) / 2, y = H - m.b - h;
    g += `<path d="M${x},${H - m.b} V${y + (h > 4 ? 4 : 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - m.b} Z" fill="${color}" data-i="${i}"><title>${esc(labels[i])}: ${fmt(v)}</title></path>`;
  });
  const step = Math.max(1, Math.ceil(n / 8));
  (tickLabels || labels).forEach((l, i) => { if (i % step === 0) g += `<text x="${m.l + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
  f.svg.insertAdjacentHTML('beforeend', g);
  f.svg.setAttribute('aria-label', `${name} by ${labels.length} periods`);
  f.svg.addEventListener('pointermove', (e) => {
    const p = e.target.closest('path[data-i]');
    if (!p) { f.tip.hidden = true; return; }
    const i = Number(p.dataset.i), r = f.svg.getBoundingClientRect(), pr = f.plot.getBoundingClientRect();
    f.tip.hidden = false; f.tip.innerHTML = `${esc(labels[i])}<br>${esc(name)}: <b>${fmt(values[i])}</b>`;
    f.tip.style.left = `${((m.l + slot * i + slot / 2) / W) * r.width + (r.left - pr.left)}px`;
    f.tip.style.top = `${((H - m.b - (H - m.t - m.b) * (values[i] / max)) / H) * r.height + (r.top - pr.top)}px`;
  });
  f.svg.addEventListener('pointerleave', () => { f.tip.hidden = true; });
}

export function hbars(el, items, { fmt = compact, color = 'var(--s1)' } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  el.innerHTML = items.length ? `<div class="bars">${items.map((i) => `<div class="bar" title="${esc(i.label)}: ${fmt(i.value)}"><span class="lbl">${esc(i.label)}</span><div class="track"><div class="fill" style="width:${(i.value / max) * 100}%;background:${i.color || color}"></div></div><b class="num">${i.text ?? fmt(i.value)}</b></div>`).join('')}</div>` : '<div class="empty-chart">No data in this range</div>';
}

export function donut(el, items, { fmt = compact } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) { el.innerHTML = '<div class="empty-chart">No data in this range</div>'; return; }
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = items.map((i) => { const len = (i.value / total) * C; const a = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${i.color}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(i.label)}: ${fmt(i.value)} (${Math.round((i.value / total) * 100)}%)</title></circle>`; off += len; return a; }).join('');
  el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="Share by ${items.map((i) => esc(i.label)).join(' and ')}">${arcs}<text x="70" y="68" text-anchor="middle" style="font-size:18px;font-weight:700;fill:var(--ink);font-family:var(--font-d)">${fmt(total)}</text><text x="70" y="84" text-anchor="middle">total</text></svg>
    <div class="legend" style="display:grid;gap:8px">${items.map((i) => `<div><i style="background:${i.color}"></i>${esc(i.label)} <b style="color:var(--ink)">${fmt(i.value)}</b> <span>${Math.round((i.value / total) * 100)}%</span></div>`).join('')}</div></div>`;
}
