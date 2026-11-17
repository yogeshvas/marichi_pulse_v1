import { api, session } from '../api.js';
import { html, raw, money } from '../ui.js';

/** Promo code and Pulse Points box shown at checkout for customers (not agents). */
export const showRewards = () => session.get()?.user.role !== 'agent';

export function rewardsBox() {
  const signedIn = Boolean(session.get());
  return html`<div class="reward-box" id="rewards"><div class="row"><strong>Offers and points</strong><span class="chip" id="bal" ${signedIn ? '' : raw('hidden')}></span></div>
    <div class="promo-row"><input id="promo" placeholder="Promo code" maxlength="30" autocomplete="off" aria-label="Promo code"><button type="button" class="btn ghost sm" id="applypromo">Apply</button></div>
    <p class="small" id="promomsg" role="status"></p>
    <label class="small" id="ptsrow" style="display:flex;gap:8px;align-items:center" ${signedIn ? '' : raw('hidden')}><input type="checkbox" id="usepts"> <span id="ptslabel">Use Pulse Points</span></label>
    ${signedIn ? '' : html`<p class="small muted">Sign in at payment to use your Pulse Points.</p>`}
    <div class="sum" id="rwsum" hidden></div></div>`;
}

/**
 * Wires the box up. ctx = { kind, offerId, extra(): number, onChange(quote) }.
 * Returns { state, refresh } where state holds what the booking request needs.
 */
export function bindRewards(root, ctx) {
  const state = { promoCode: '', usePoints: false, quote: null };
  const box = root.querySelector('#rewards');
  if (!box) return state;
  const msg = box.querySelector('#promomsg'), sum = box.querySelector('#rwsum');
  const refresh = async (applying = false) => {
    try {
      const q = await api('/checkout/quote', { method: 'POST', body: { kind: ctx.kind, offerId: ctx.offerId, extra: ctx.extra?.() || 0, promoCode: state.promoCode || undefined, usePoints: state.usePoints } });
      state.quote = q;
      if (applying && q.promoCode) { msg.className = 'small pos'; msg.textContent = `${q.promoCode} applied. You save ${money(q.promoDiscount)}.`; }
      const bal = box.querySelector('#bal');
      if (session.get()) {
        bal.hidden = false; bal.textContent = `${q.balance.toLocaleString('en-GB')} points`;
        const room = Math.max(0, q.total - q.promoDiscount);
        const max = Math.max(0, Math.min(q.balance, Math.floor(room * 0.1)));
        box.querySelector('#ptslabel').textContent = max ? `Use ${max.toLocaleString('en-GB')} Pulse Points (save ${money(max)})` : 'No points to use on this booking yet';
        box.querySelector('#usepts').disabled = !max;
      }
      sum.hidden = !q.discount;
      sum.innerHTML = q.discount ? `<div><span>Price</span><span class="num">${money(q.total)}</span></div>${q.promoDiscount ? `<div><span>Promo ${q.promoCode}</span><span class="num pos">−${money(q.promoDiscount)}</span></div>` : ''}${q.pointsDiscount ? `<div><span>${q.pointsUsed} points</span><span class="num pos">−${money(q.pointsDiscount)}</span></div>` : ''}<div class="tot"><span>You pay</span><span class="num">${money(q.payable)}</span></div>` : '';
      ctx.onChange?.(q);
    } catch (e) {
      if (applying) { state.promoCode = ''; msg.className = 'small neg'; msg.textContent = e.message; refresh(); }
    }
  };
  box.querySelector('#applypromo').addEventListener('click', () => { state.promoCode = box.querySelector('#promo').value.trim().toUpperCase(); if (!state.promoCode) { msg.textContent = ''; return refresh(); } refresh(true); });
  box.querySelector('#promo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('#applypromo').click(); } });
  box.querySelector('#usepts').addEventListener('change', (e) => { state.usePoints = e.target.checked; refresh(); });
  state.refresh = refresh;
  refresh();
  return state;
}
