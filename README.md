# ⚡ SentQuote

**Send quotes. Know when they’re read. Get paid.**

SentQuote is a lightweight, self-hostable SaaS for freelancers, contractors, and small service businesses to create trackable quotes with built-in payment collection.

-----

## The Problem

Small service businesses lose thousands of dollars per year because they send quotes via email or PDF, then have zero visibility into whether the client opened it, no automated follow-up, and no easy way for clients to accept and pay. The gap between “quote sent” and “quote accepted” is where deals die in silence.

## The Product

SentQuote is the simplest quote-to-payment tool:

1. **Build a quote** — line items, tax, deposit amount. 60 seconds.
1. **Share the link** — get pinged the instant the client views it.
1. **Get paid** — client accepts and pays the deposit via Stripe. Done.

Because the quote lives on a webpage (not a dead PDF), every view is tracked automatically. No pixel tricks, no email hacks. The client hits the server to see the quote — that request *is* the signal.

-----

## Features (MVP)

- ✅ Quote builder with line items, tax rate, deposit percentage
- ✅ Shareable quote links (`/q/abc123`)
- ✅ Real-time view tracking (count, first viewed, last viewed)
- ✅ Event timeline (sent → viewed → accepted → paid)
- ✅ One-click quote acceptance (client-facing)
- ✅ Stripe Checkout for deposit or full payment collection
- ✅ Dashboard with pipeline stats (sent, accepted, paid, revenue)
- ✅ Auto follow-up scheduling (3-day and 7-day reminders)
- ✅ User authentication (email/password + JWT)
- ✅ Privacy policy and terms of service pages

## Out of Scope (v1)

- Email/push notifications (requires SendGrid or similar)
- Custom branding (logo, colors) on quotes
- PDF export
- Team / multi-user accounts
- CRM or QuickBooks integrations
- Quote templates
- E-signatures

-----

## Tech Stack

|Layer   |Choice                      |Why                                        |
|--------|----------------------------|-------------------------------------------|
|Runtime |Node.js + Express 5         |Fastest path to a production API           |
|Database|SQLite (better-sqlite3)     |Zero ops, single file, no managed DB cost  |
|Auth    |bcrypt + JWT                |Stateless, no third-party dependency       |
|Payments|Stripe Checkout             |Industry standard, handles PCI compliance  |
|Frontend|React 18 (CDN) + vanilla CSS|No build step, instant deploy, <100KB total|
|Hosting |Any VPS or Railway/Render   |~$5–7/month                                |

**Why this stack:** Single developer, zero DevOps, $0 infrastructure cost in development, <$10/month in production. No build step means deploy = push files. SQLite handles thousands of concurrent reads — more than enough for early-stage SaaS.

-----

## Project Structure

```
sentquote/
├── server/
│   ├── index.js          # Express API server (all routes)
│   ├── db.js             # SQLite schema and initialization
│   └── auth.js           # JWT middleware and token generation
├── public/
│   ├── index.html        # React SPA (landing, dashboard, quote builder, public quote)
│   ├── privacy.html      # Privacy policy
│   └── terms.html        # Terms of service
├── data/                  # SQLite database (auto-created)
├── .env.example           # Environment variable template
├── package.json
└── README.md
```

-----

## Setup

### Prerequisites

- Node.js 18+
- npm

### Quick Start

```bash
# Clone the repo
git clone https://github.com/yourname/sentquote.git
cd sentquote

# Install dependencies
npm install

# Create your environment config
cp .env.example .env
# Edit .env with your values (see below)

# Start the server
npm start

# Open http://localhost:3001
```

### Environment Variables

|Variable               |Required|Default              |Description                                         |
|-----------------------|--------|---------------------|----------------------------------------------------|
|`PORT`                 |No      |`3001`               |Server port                                         |
|`BASE_URL`             |**Yes** |—                    |Your public URL (e.g. `https://sentquote.com`)      |
|`JWT_SECRET`           |**Yes** |—                    |Random 64+ character string for signing auth tokens |
|`STRIPE_SECRET_KEY`    |No*     |—                    |Stripe secret key (starts with `sk_`)               |
|`STRIPE_WEBHOOK_SECRET`|No*     |—                    |Stripe webhook signing secret (starts with `whsec_`)|
|`DB_PATH`              |No      |`./data/sentquote.db`|Path to SQLite database file                        |

*Required for payment collection to work. Everything else functions without Stripe configured.

-----

## Stripe Setup

Payments are optional for development but required for production.

1. Create a [Stripe account](https://dashboard.stripe.com/register)
1. Copy your **Secret key** from the Developers → API keys page
1. Add it as `STRIPE_SECRET_KEY` in `.env`
1. Create a webhook endpoint pointing to `https://yourdomain.com/api/webhooks/stripe`
- Select the `checkout.session.completed` event
1. Copy the webhook signing secret and add as `STRIPE_WEBHOOK_SECRET` in `.env`

For local development, use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

-----

## API Reference

### Authentication

|Method|Endpoint            |Description                                                |
|------|--------------------|-----------------------------------------------------------|
|POST  |`/api/auth/register`|Create account `{email, password, businessName}`           |
|POST  |`/api/auth/login`   |Login `{email, password}` → returns JWT token              |
|GET   |`/api/auth/me`      |Get current user (requires `Authorization: Bearer <token>`)|

### Quotes (authenticated)

|Method|Endpoint              |Description                                  |
|------|----------------------|---------------------------------------------|
|GET   |`/api/quotes`         |List all quotes for current user             |
|POST  |`/api/quotes`         |Create a new quote                           |
|GET   |`/api/quotes/:id`     |Get quote detail + event timeline            |
|PUT   |`/api/quotes/:id`     |Update a quote                               |
|DELETE|`/api/quotes/:id`     |Delete a quote                               |
|POST  |`/api/quotes/:id/send`|Mark quote as sent + schedule auto follow-ups|

### Public (unauthenticated — client-facing)

|Method|Endpoint                         |Description                                 |
|------|---------------------------------|--------------------------------------------|
|GET   |`/api/public/quotes/:slug`       |View a quote (tracks the view automatically)|
|POST  |`/api/public/quotes/:slug/accept`|Accept a quote                              |
|POST  |`/api/public/quotes/:slug/pay`   |Create Stripe Checkout session for payment  |

### Dashboard

|Method|Endpoint    |Description                          |
|------|------------|-------------------------------------|
|GET   |`/api/stats`|Pipeline stats + recent activity feed|

### Billing

|Method|Endpoint               |Description                                     |
|------|-----------------------|------------------------------------------------|
|POST  |`/api/billing/checkout`|Create Stripe subscription checkout for Pro plan|
|POST  |`/api/webhooks/stripe` |Stripe webhook receiver                         |

### Quote Creation Payload

```json
{
  "clientName": "Jane Smith",
  "clientEmail": "jane@company.com",
  "title": "Kitchen Remodel",
  "description": "Full gut renovation of 120 sq ft kitchen",
  "lineItems": [
    { "description": "Demo & haul-away", "quantity": 1, "unitPrice": 3500 },
    { "description": "Cabinets (supply + install)", "quantity": 1, "unitPrice": 12000 },
    { "description": "Countertops (quartz)", "quantity": 35, "unitPrice": 85 }
  ],
  "taxRate": 10.1,
  "depositPercent": 50,
  "validDays": 30,
  "notes": "50% deposit to schedule. Balance due on completion. Timeline: 6–8 weeks."
}
```

All monetary values are stored internally as cents (integers). `unitPrice` in the payload is in dollars and converted on the server.

-----

## Deployment

### Railway (Recommended)

1. Push code to GitHub
1. Create a new project on [Railway](https://railway.app)
1. Connect your GitHub repo
1. Add a **Volume** and mount it at `/data`
1. Set environment variables:
- `BASE_URL` = your Railway public URL or custom domain
- `JWT_SECRET` = random 64-char string
- `STRIPE_SECRET_KEY` = your Stripe key
- `STRIPE_WEBHOOK_SECRET` = your webhook secret
- `DB_PATH` = `/data/sentquote.db`
1. Deploy — Railway auto-detects Node.js
1. (Optional) Add custom domain: point `sentquote.com` DNS to Railway

**Total time:** ~20 minutes. **Monthly cost:** ~$5–7.

### Render

1. Create a new **Web Service** on [Render](https://render.com)
1. Connect your GitHub repo
1. Build command: `npm install`
1. Start command: `npm start`
1. Add a **Disk** and mount at `/data`
1. Set environment variables (same as above)
1. Use a paid instance ($7/month) to avoid cold starts

### Any VPS (DigitalOcean, Hetzner, etc.)

```bash
# On your server
git clone your-repo
cd sentquote
npm install --production
cp .env.example .env
nano .env  # add production values

# Run with PM2 for auto-restart
npm install -g pm2
pm2 start server/index.js --name sentquote
pm2 save
pm2 startup

# Set up nginx reverse proxy + Let's Encrypt SSL
# (standard nginx + certbot setup — plenty of guides online)
```

-----

## Pricing Model

|Plan    |Price |Includes                                                                    |
|--------|------|----------------------------------------------------------------------------|
|**Free**|$0/mo |5 quotes/month, view tracking, link sharing, basic dashboard                |
|**Pro** |$29/mo|Unlimited quotes, Stripe payment collection, auto follow-ups, full analytics|

Free tier enforced at the application level (not currently implemented in MVP — all features available during launch).

-----

## Launch Checklist

- [ ] Register domain (`sentquote.com` — confirmed available)
- [ ] Deploy to Railway or Render
- [ ] Set `BASE_URL` to production domain
- [ ] Generate and set `JWT_SECRET` (use `openssl rand -hex 32`)
- [ ] Configure Stripe keys (test mode first, then live)
- [ ] Create Stripe webhook for `checkout.session.completed`
- [ ] Test full flow: register → create quote → send → view public link → accept → pay
- [ ] Set up error monitoring (Sentry free tier or LogTail)
- [ ] Set up uptime monitoring (BetterUptime free tier)
- [ ] Add Google Analytics or Plausible to `public/index.html`
- [ ] Verify privacy policy and terms pages are accessible
- [ ] DNS propagation confirmed
- [ ] SSL certificate active (auto via Railway/Render)
- [ ] First Reddit launch post drafted and ready
- [ ] Screenshot of dashboard ready for social proof

-----

## Development

```bash
# Start the server in development
npm run dev

# The server serves both the API and the frontend
# API: http://localhost:3001/api/*
# Frontend: http://localhost:3001/*

# Database is auto-created on first run at DB_PATH
# To reset: delete the .db file and restart
```

No build step required. Edit `public/index.html` and refresh.

-----

## Competitors & Positioning

|Product         |Price       |What they are                |How we differ                                     |
|----------------|------------|-----------------------------|--------------------------------------------------|
|PandaDoc        |$49+/user/mo|Enterprise proposal platform |We’re 60 seconds, not 60 minutes                  |
|Proposify       |$49+/user/mo|Sales proposal builder       |We don’t build proposals, we track prices         |
|Better Proposals|$19+/user/mo|Proposal design tool         |Simpler, cheaper, payment-first                   |
|HoneyBook       |$19+/mo     |All-in-one freelance platform|We do one thing and do it well                    |
|Bonsai          |$25+/mo     |Freelance business suite     |Not a suite — just send, track, get paid          |
|**PDF / Email** |Free        |What everyone actually uses  |Our real competitor. Zero tracking, zero payments.|

-----

## License

MIT

-----

Built with frustration and caffeine. Stop sending quotes into the void.
