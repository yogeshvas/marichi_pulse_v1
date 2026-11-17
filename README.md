# Marichi Pulse: flight and hotel booking platform

By Marichi Labs. Built for Zambia: prices in Zambian Kwacha (ZMW), Zambian airports and airlines, lodges and hotels, VAT at 16%, and payment by mobile money (MTN, Airtel, Zamtel) or card.

One Node.js server with three portals on the Amadeus Self-Service APIs.

| Portal | Address | For |
|---|---|---|
| Customer site | http://localhost:3000 | Search, book, My trips, account, support |
| Agent portal | http://localhost:3000/console/ | Book for customers, customer list, wallet, commission, reports |
| Admin portal | http://localhost:3000/console/ | Analytics, agents, pricing, all bookings, reports, support, audit log |

## Highlights

- Fare calendar: cheapest price for the 3 days either side of your date, one click to switch.
- Smart badges: Best value, Cheapest and Fastest on every flight.
- Promo codes (managed by admin) and Pulse Points rewards with Bronze, Silver and Gold tiers.
- Add to calendar (.ics), trip countdown, and WhatsApp quote sharing for agents.
- Admin analytics with change against the previous period, and a ⌘K search across the console.

## Intelligence

- **Ask Pulse assistant:** type or say "Delhi to Goa next Friday for 2 under 8k" and it sets up the search. Also answers refund, offers, points and "my trips" questions.
- **Buy or wait advice** on every flight search, with the reasons and a confidence level.
- **Trip planner:** flight and hotel packages (lowest price, best value, comfort) that fit a budget, booked in one flow.
- **Picked for you:** repeat trips from your history, plus routes trending in searches.
- **Pulse insights and 14 day sales forecast** for admins and agents, a booking **risk score** for admins, and a next-best-action note on each agent customer.
- Works without any AI key. Set `ANTHROPIC_API_KEY` in `.env` to let Claude read harder sentences and answer open questions.

## Run

```bash
npm install
npm start
npm test
```

First start with no Amadeus keys loads demo data (60 days of bookings) so the dashboards are not empty.

| Role | Email | Password |
|---|---|---|
| Admin | admin@skyline.test | Admin@12345 |
| Agent | agent@skyline.test | Agent@12345 |
| Customer | customer@skyline.test | Customer@12345 |

Test card: `4111 1111 1111 1111`, any future expiry. `4000 0000 0000 0002` is declined.

## Go live with Amadeus

Copy `.env.example` to `.env`, set `AMADEUS_CLIENT_ID` and `AMADEUS_CLIENT_SECRET`, set a strong `JWT_SECRET`,
`ADMIN_EMAIL` and `ADMIN_PASSWORD`, then delete `data/skyline.db` to drop the demo data and restart.
Hotels also need the agency payment card (`AGENCY_CARD_*` in `.env.example`). The platform pays the hotel with it and
collects the customer price through your payment gateway.

## Zambia notes

- Currency is `ZMW`. Set `CURRENCY` in `.env` if Amadeus does not quote a route in Kwacha (use `USD`).
- Mobile money is the default payment. The demo approves any valid Zambian number. For real payments connect an aggregator such as Lenco, DPO Pay or Flutterwave in `src/services/payments.js` (`chargeMomo`).
- Demo airports: Lusaka, Ndola, Livingstone, Mfuwe, Solwezi, Kasama, Chipata, Mongu, plus regional and international routes.

## How money works

- Customers pay the Amadeus price plus the customer markup. Agents get the lower agent rate.
- An agent can add a service fee and collect from the customer, or pay from the wallet and collect offline.
- Commission is a percentage of the base fare, paid into the agent wallet and reversed on cancellation.
- Platform revenue is markup minus commission. Markup and commission are set in Pricing and settings.

## Layout

- `src/providers/amadeus` real Amadeus calls. `src/providers/mock` demo data in the same shapes.
- `src/services` booking flow, pricing, wallet, reports, payments adapter, audit.
- `src/routes` REST API under `/api` (auth, catalog, bookings, reports, agent, admin, support, account).
- `public` customer site. `public/console` agent and admin portal.

## Before production

- Replace the demo payment gateway in `src/services/payments.js` (Razorpay or Stripe) and send gateway tokens, not card numbers.
- Issuing real flight tickets needs an Amadeus consolidator agreement. Seat choices go to the airline as requests.
- Hotel cancellation has no Self-Service API, so it is recorded as a request for your team.
- The email notifier only logs. Offers are cached in memory (use Redis for several servers).
- SQLite suits one server. Move to Postgres for scale.
