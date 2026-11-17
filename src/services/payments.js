import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { AppError } from '../errors.js';

function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateCard(card) {
  const digits = card.number.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) throw new AppError(402, 'CARD_INVALID', 'The card number is not valid.');
  const now = new Date();
  if (card.expYear < now.getFullYear() || (card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1)) {
    throw new AppError(402, 'CARD_EXPIRED', 'This card has expired.');
  }
  return digits;
}

/**
 * Payment gateway adapter. This one is a stand-in that approves valid cards.
 * Replace charge() and refund() with Razorpay, Stripe or your gateway. Send a gateway token from the browser
 * instead of raw card numbers so card data never reaches this server.
 */
export async function charge({ amount, currency, card, provider = 'demo-gateway' }) {
  const digits = validateCard(card);
  if (digits === '4000000000000002') throw new AppError(402, 'CARD_DECLINED', 'The bank declined this card. Try another card.');
  const id = `pay_${randomUUID().slice(0, 12)}`;
  db.prepare('INSERT INTO payments (id, provider, amount, currency, status, card_last4) VALUES (?,?,?,?,?,?)')
    .run(id, provider, amount, currency, 'captured', digits.slice(-4));
  return { id, last4: digits.slice(-4) };
}

/**
 * Mobile money (MTN, Airtel, Zamtel). The demo approves any valid Zambian number, except numbers ending 0000.
 * For real payments connect an aggregator such as Lenco, DPO Pay or Flutterwave in this function.
 */
export async function chargeMomo({ amount, currency, momo }) {
  if (momo.phone.endsWith('0000')) throw new AppError(402, 'MOMO_DECLINED', 'The payment was not approved on your phone. Check your balance and try again.');
  const id = `pay_${randomUUID().slice(0, 12)}`;
  db.prepare('INSERT INTO payments (id, provider, amount, currency, status, card_last4) VALUES (?,?,?,?,?,?)').run(id, `momo-${momo.network}`, amount, currency, 'captured', momo.phone.slice(-4));
  return { id, last4: momo.phone.slice(-4), method: 'momo', network: momo.network };
}

/** Takes a payment by card or mobile money, whichever the person chose. */
export async function chargeAny({ amount, currency, card, momo }) {
  if (momo) return chargeMomo({ amount, currency, momo });
  if (!card) throw new AppError(400, 'PAYMENT_REQUIRED', 'Choose how you want to pay.');
  const p = await charge({ amount, currency, card });
  return { ...p, method: 'card' };
}

/** Card is forwarded to the hotel provider, which takes the payment. We only record that it happened. */
export function recordPassthrough({ amount, currency, card }) {
  const digits = validateCard(card);
  const id = `pay_${randomUUID().slice(0, 12)}`;
  db.prepare('INSERT INTO payments (id, provider, amount, currency, status, card_last4) VALUES (?,?,?,?,?,?)')
    .run(id, 'provider-passthrough', amount, currency, 'forwarded', digits.slice(-4));
  return { id, last4: digits.slice(-4) };
}

export async function refund(paymentId, amount) {
  db.prepare("UPDATE payments SET status = ? WHERE id = ?").run(amount > 0 ? 'refunded' : 'no_refund', paymentId);
  return { id: paymentId, amount };
}

export function attachBooking(paymentId, ref) {
  db.prepare('UPDATE payments SET booking_ref = ? WHERE id = ?').run(ref, paymentId);
}
