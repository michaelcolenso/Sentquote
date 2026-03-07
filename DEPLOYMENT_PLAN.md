# SentQuote Deployment Plan

## Goal
Deploy SentQuote to production with persistent SQLite storage, Stripe payments, and a safe rollback path.

## Recommended Target
Railway web service + Railway volume mounted at `/data`.

Reason:
- This app serves API + frontend from one Node process.
- SQLite needs a persistent disk.
- Railway keeps setup simple for first production launch.

## Phase 1: Pre-Deployment Hardening (Required)

### 1.1 Secrets and config safety
- Create `.env.example` in repo with non-secret placeholders:
  - `PORT=3001`
  - `BASE_URL=https://your-domain.com`
  - `JWT_SECRET=replace-with-64-char-secret`
  - `STRIPE_SECRET_KEY=sk_live_xxx`
  - `STRIPE_WEBHOOK_SECRET=whsec_xxx`
  - `DB_PATH=/data/sentquote.db`
- Add `.gitignore` entries:
  - `.env`
  - `data/*.db`
  - `data/*.db-shm`
  - `data/*.db-wal`
  - `node_modules/`

### 1.2 Stripe webhook reliability
- Fix webhook body parsing so signature verification works in production.
- Current risk: `express.json()` is mounted globally before webhook route; Stripe route should receive raw body bytes.
- Implementation target:
  - Mount webhook route with raw parser before global JSON parser, or
  - Use conditional middleware to skip JSON parsing for `/api/webhooks/stripe`.

### 1.3 Production-only safeguards
- Fail startup in production when `JWT_SECRET` is missing or default.
- Set strict CORS origin(s) from env for production.
- Add a health endpoint (`GET /api/health`) returning 200 and basic app metadata.

## Phase 2: Infrastructure Setup

### 2.1 Railway project
- Create Railway project from GitHub repo.
- Add one web service.
- Add persistent volume and mount at `/data`.

### 2.2 Runtime settings
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health` (after phase 1.3)

### 2.3 Environment variables
Set in Railway:
- `NODE_ENV=production`
- `PORT=3001` (Railway may override internally)
- `BASE_URL=https://<your-domain>`
- `JWT_SECRET=<64+ char random string>`
- `STRIPE_SECRET_KEY=<live or test key>`
- `STRIPE_WEBHOOK_SECRET=<webhook secret>`
- `DB_PATH=/data/sentquote.db`

## Phase 3: First Production Deploy

### 3.1 Deploy order
- Merge pre-deploy hardening changes into main.
- Deploy from main branch.
- Confirm service boot logs show app listening and no startup warnings.

### 3.2 Domain + TLS
- Attach custom domain.
- Update DNS to Railway target.
- Wait for TLS cert issuance.
- Update `BASE_URL` to final domain if needed, then redeploy.

### 3.3 Stripe setup
- In Stripe dashboard, create webhook endpoint:
  - `https://<your-domain>/api/webhooks/stripe`
- Subscribe at minimum to:
  - `checkout.session.completed`
- Copy signing secret to `STRIPE_WEBHOOK_SECRET`.

## Phase 4: Go-Live Validation Checklist

Run in production:
- Register user and login.
- Call `/api/auth/me` with JWT.
- Create quote, send quote, open public quote URL.
- Accept quote from public page.
- Pay quote using Stripe Checkout test mode first.
- Confirm quote status transitions in DB and dashboard stats.
- Confirm webhook events are 2xx in Stripe dashboard.
- Confirm `privacy.html` and `terms.html` are publicly accessible.

## Phase 5: Operations, Backups, and Rollback

### 5.1 Monitoring
- Add uptime checks for:
  - `/api/health`
  - `/`
- Add log alerts for:
  - 5xx rate spikes
  - Stripe webhook failures

### 5.2 SQLite backup plan
- Daily snapshot/copy of `/data/sentquote.db`.
- Keep at least 7 daily backups.
- Test restore once before full launch.

### 5.3 Rollback strategy
- Keep previous Railway deploy available.
- Roll back to last known good deploy if:
  - auth failures increase,
  - quote creation fails,
  - payment webhook failures persist.
- If schema changes are introduced later, pair app rollback with DB compatibility checks.

## Timeline (Practical)
- Day 1: Phase 1 hardening changes + local verification.
- Day 2: Railway setup + first deploy + Stripe webhook configuration.
- Day 3: Production smoke tests + monitoring + launch.

