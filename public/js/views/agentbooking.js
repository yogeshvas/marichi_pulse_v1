import { api, session } from '../api.js';
import { html, raw, field, money } from '../ui.js';

export const isAgent = () => session.get()?.user.role === 'agent';

/** Loads what the agent needs at checkout: their customers and wallet. */
export async function loadAgentContext() {
  if (!isAgent()) return null;
  try {
    const [{ customers }, wallet] = await Promise.all([api('/agent/customers'), api('/agent/wallet')]);
    return { customers, wallet, opts: { customerId: '', serviceFee: 0, paymentMode: 'wallet', newCustomer: { name: '', email: '', phone: '' } } };
  } catch { return null; }
}

export const usesCardBox = (ctx) => !ctx || ctx.opts.paymentMode === 'card';

export function agentPanel(ctx, base, cur) {
  if (!ctx) return '';
  const o = ctx.opts;
  const fee = Number(o.serviceFee) || 0;
  return html`<div class="pass" id="agentbox"><div class="row"><strong>Agent booking</strong><span class="chip">Wallet ${money(ctx.wallet.balance, cur)}</span></div>
    <label class="field"><span>Customer</span><select name="agent.customer"><option value="">+ New customer</option>
      ${ctx.customers.map((c) => html`<option value="${c.id}" ${String(o.customerId) === String(c.id) ? raw('selected') : ''}>${c.name}${c.email ? ` · ${c.email}` : ''}</option>`)}</select></label>
    <div class="grid g3" id="newcust" ${o.customerId ? raw('hidden') : ''}>
      ${field('Customer name', 'agent.name', { value: o.newCustomer.name, required: false })}${field('Email', 'agent.email', { type: 'email', value: o.newCustomer.email, required: false })}${field('Phone', 'agent.phone', { value: o.newCustomer.phone, required: false })}</div>
    <div class="grid g2">${field('Your service fee', 'agent.fee', { type: 'number', value: fee, attrs: 'min="0" step="50"', required: false })}
      <fieldset style="border:0;padding:0;margin:0"><legend class="small muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">Collect payment</legend>
        <div class="seg" style="margin-top:6px"><label><input type="radio" name="agent.mode" value="wallet" ${o.paymentMode === 'wallet' ? raw('checked') : ''}><span>From my wallet</span></label>
          <label><input type="radio" name="agent.mode" value="card" ${o.paymentMode === 'card' ? raw('checked') : ''}><span>Customer card</span></label></div></fieldset></div>
    <p class="small muted" id="agentnote">${o.paymentMode === 'wallet' ? `${money(base, cur)} is taken from your wallet. Collect ${money(base + fee, cur)} from the customer yourself.` : `The customer card is charged ${money(base + fee, cur)}. Your fee is paid into your wallet.`}</p></div>`;
}

export function readAgent(form, ctx) {
  const f = form.elements;
  ctx.opts.customerId = f['agent.customer'].value;
  ctx.opts.serviceFee = Number(f['agent.fee'].value) || 0;
  ctx.opts.paymentMode = form.querySelector('[name="agent.mode"]:checked').value;
  ctx.opts.newCustomer = { name: f['agent.name'].value.trim(), email: f['agent.email'].value.trim(), phone: f['agent.phone'].value.trim() };
  const errors = {};
  if (!ctx.opts.customerId && ctx.opts.newCustomer.name.length < 2) errors['agent.name'] = 'Enter the customer name';
  if (ctx.opts.serviceFee < 0) errors['agent.fee'] = 'Cannot be negative';
  const body = { serviceFee: ctx.opts.serviceFee, paymentMode: ctx.opts.paymentMode };
  if (ctx.opts.customerId) body.customerId = Number(ctx.opts.customerId);
  else body.newCustomer = ctx.opts.newCustomer;
  return { body, errors };
}

/** Shows or hides parts of the panel without redrawing the form. */
export function bindAgentPanel(form, ctx, base, cur) {
  if (!ctx) return;
  const note = () => {
    const fee = Number(form.elements['agent.fee'].value) || 0;
    const mode = form.querySelector('[name="agent.mode"]:checked').value;
    form.querySelector('#agentnote').textContent = mode === 'wallet'
      ? `${money(base, cur)} is taken from your wallet. Collect ${money(base + fee, cur)} from the customer yourself.`
      : `The customer card is charged ${money(base + fee, cur)}. Your fee is paid into your wallet.`;
    form.querySelector('#cardbox').hidden = mode === 'wallet';
  };
  form.elements['agent.customer'].addEventListener('change', (e) => { form.querySelector('#newcust').hidden = Boolean(e.target.value); });
  form.querySelectorAll('[name="agent.mode"]').forEach((r) => r.addEventListener('change', note));
  form.elements['agent.fee'].addEventListener('input', note);
  note();
}
