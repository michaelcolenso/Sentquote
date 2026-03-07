# SentQuote — Agent Guide

## Project Overview

SentQuote is a lightweight, self-hostable SaaS for freelancers, contractors, and small service businesses to create trackable quotes with built-in payment collection. The application allows users to:

- Build quotes with line items, tax rates, and deposit amounts
- Share trackable quote links (`/q/abc123`) with clients
- Track when clients view quotes in real-time
- Accept payments via Stripe Checkout
- Manage quotes through a dashboard with pipeline stats
- Receive automatic follow-up emails

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js 18+ + Express 5 | API server and static file serving |
| Database | SQLite (better-sqlite3) | Zero-ops persistent storage with WAL mode |
| Auth | bcryptjs + JWT | Stateless authentication |
| Validation | Zod | Runtime type validation |
| Security | Helmet + express-rate-limit | Security headers and rate limiting |
| Payments | Stripe Checkout | PCI-compliant payment processing |
| Frontend | React 18 (CDN) + vanilla CSS | No-build-step SPA (<100KB total) |
| Email | nodemailer | Email delivery for follow-ups and notifications |
| Logging | Winston | Structured logging with request tracing |

## Project Structure

```
sentquote/
├── server/
│   ├── index.js              # Express app setup and middleware
│   ├── db.js                 # SQLite initialization and migrations
│   ├── auth.js               # JWT helpers and auth middleware
│   ├── routes/               # API route modules
│   │   ├── auth.js           # Authentication endpoints
│   │   ├── quotes.js         # Quote CRUD operations
│   │   ├── public.js         # Public client-facing endpoints
│   │   ├── dashboard.js      # Stats and activity feed
│   │   └── billing.js        # Stripe integration
│   ├── middleware/           # Express middleware
│   │   ├── validator.js      # Zod validation middleware
│   │   ├── errorHandler.js   # Global error handling
│   │   └── requestId.js      # Request ID generation
│   ├── services/             # Business logic services
│   │   ├── email.js          # Email sending service
│   │   ├── stripe.js         # Stripe API integration
│   │   └── followups.js      # Background follow-up processor
│   ├── validators/           # Zod schemas
│   │   └── schemas.js        # Input validation schemas
│   └── utils/                # Utilities
│       ├── logger.js         # Winston logger configuration
│       └── slug.js           # Slug generation utilities
├── public/
│   ├── index.html            # React SPA (landing, dashboard, quote builder)
│   ├── privacy.html          # Static privacy policy page
│   └── terms.html            # Static terms of service page
├── data/                     # SQLite database files (auto-created)
├── .env                      # Environment variables (not committed)
├── .env.example              # Environment variable template
├── package.json              # Dependencies and npm scripts
└── README.md                 # Human-readable documentation
```

## Database Schema

### Tables

**users**: User accounts
- `id` (TEXT PRIMARY KEY): UUID
- `email` (TEXT UNIQUE): User email address
- `password_hash` (TEXT): bcrypt hashed password
- `business_name` (TEXT): Display name for business
- `stripe_account_id` (TEXT): Connected Stripe account
- `stripe_connected` (INTEGER): Boolean flag for Stripe connection
- `plan` (TEXT): 'free' or 'pro'
- `created_at`, `updated_at` (TEXT): ISO timestamps

**quotes**: Quote records
- `id` (TEXT PRIMARY KEY): UUID
- `user_id` (TEXT): Foreign key to users
- `slug` (TEXT UNIQUE): 8-character public identifier
- `client_name`, `client_email` (TEXT): Client contact info
- `title`, `description` (TEXT): Quote details
- `line_items` (TEXT): JSON array of line items
- `subtotal`, `tax_amount`, `total` (INTEGER): Amounts in cents
- `tax_rate` (REAL): Tax percentage
- `deposit_percent`, `deposit_amount` (INTEGER): Deposit configuration
- `currency` (TEXT): Currency code (default 'usd')
- `valid_until` (TEXT): Quote expiration date
- `status` (TEXT): 'draft', 'sent', 'accepted', 'paid', or 'expired'
- `accepted_at`, `paid_at` (TEXT): Timestamps for state changes
- `paid_amount` (INTEGER): Amount actually paid
- `stripe_payment_intent` (TEXT): Stripe payment reference
- `notes` (TEXT): Additional quote notes
- `view_count` (INTEGER): Number of public views
- `first_viewed_at`, `last_viewed_at` (TEXT): View tracking

**quote_events**: Audit trail
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `quote_id` (TEXT): Foreign key
- `event_type` (TEXT): 'sent', 'viewed', 'accepted', 'paid', etc.
- `metadata` (TEXT): JSON additional data
- `ip_address`, `user_agent` (TEXT): Client info
- `created_at` (TEXT): Timestamp

**followups**: Scheduled follow-up reminders
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `quote_id` (TEXT): Foreign key
- `scheduled_at` (TEXT): When to send
- `sent_at` (TEXT): When actually sent
- `message` (TEXT): Reminder content
- `status` (TEXT): 'pending', 'sent', or 'cancelled'

**password_resets**: Password reset tokens
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `user_id` (TEXT): Foreign key
- `token` (TEXT UNIQUE): Reset token
- `expires_at` (TEXT): Token expiration
- `used_at` (TEXT): When token was used
- `created_at` (TEXT): Timestamp

### Indexes
All tables have appropriate indexes for query performance:
- `idx_quotes_user`, `idx_quotes_slug`, `idx_quotes_status`, `idx_quotes_created`
- `idx_events_quote`, `idx_events_created`
- `idx_followups_status`, `idx_followups_scheduled`
- `idx_password_resets_token`, `idx_password_resets_expires`

## API Endpoints (v1)

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account `{email, password, businessName}` |
| POST | `/api/v1/auth/login` | Login `{email, password}` → returns JWT |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/auth/forgot-password` | Request password reset |

### Quotes (Authenticated)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/quotes?page=1&limit=20` | List quotes (paginated) |
| POST | `/api/v1/quotes` | Create a new quote |
| GET | `/api/v1/quotes/:id` | Get quote detail + events |
| PUT | `/api/v1/quotes/:id` | Update a quote (draft only) |
| DELETE | `/api/v1/quotes/:id` | Delete a quote |
| POST | `/api/v1/quotes/:id/send` | Mark quote as sent + schedule follow-ups |

### Public (Client-Facing)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/public/quotes/:slug` | View a quote (tracks view) |
| POST | `/api/v1/public/quotes/:slug/accept` | Accept a quote |
| POST | `/api/v1/public/quotes/:slug/pay` | Create Stripe Checkout session |

### Dashboard & Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard/stats` | Pipeline stats + needs attention |
| GET | `/api/v1/dashboard/activity` | Activity feed with pagination |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/billing/stripe/connect` | Connect Stripe Express account |
| POST | `/api/v1/billing/checkout` | Create Pro subscription checkout |
| POST | `/api/v1/billing/webhooks/stripe` | Stripe webhook receiver |

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health status |

**Legacy routes** (`/api/*`) are maintained for backward compatibility.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start production server
npm start

# Start development server with auto-reload
npm run dev

# Run database reset (delete data folder and restart)
rm -rf data && npm start
```

The server runs on `PORT` environment variable or defaults to 3001.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3001 | Server port |
| `BASE_URL` | **Yes** | — | Public URL (e.g., `https://sentquote.com`) |
| `JWT_SECRET` | **Yes*** | — | Random 64+ character string for JWT |
| `DB_PATH` | No | `./data/sentquote.db` | SQLite database path |
| `NODE_ENV` | No | — | 'production' for production safeguards |
| `CORS_ORIGIN` | No | `*` | Comma-separated allowed origins |
| `SMTP_HOST` | No | — | SMTP server for email |
| `SMTP_PORT` | No | 587 | SMTP port |
| `SMTP_SECURE` | No | false | Use TLS |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `FROM_EMAIL` | No | noreply@sentquote.com | Sender email |
| `STRIPE_SECRET_KEY` | No | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook secret |
| `LOG_LEVEL` | No | info | Winston log level |

\* Required in production. Must be 32+ characters, not contain default values.

## Code Style Guidelines

### JavaScript
- Use **2-space indentation**
- Always use **semicolons**
- Prefer `const` and `let` over `var`
- Use **CommonJS modules** (`require` / `module.exports`)
- Use **camelCase** for JS identifiers and request/response fields

### Database
- Use **snake_case** for column names
- Store monetary values as **integers** (cents)
- Use ISO 8601 strings for timestamps
- Always use **transactions** for multi-step operations

### Validation
- Use Zod schemas for all inputs
- Validate at route level using middleware
- Return detailed validation errors

### Error Handling
- Use centralized error handler middleware
- Log all errors with request context
- Don't expose stack traces in production

### Example Patterns
```javascript
// Good: Transaction for data integrity
const createQuote = db.transaction(() => {
  db.prepare('INSERT INTO quotes...').run();
  db.prepare('INSERT INTO followups...').run();
});
createQuote();

// Good: Zod validation
const createQuoteSchema = z.object({
  clientName: z.string().min(1).max(200),
  lineItems: z.array(lineItemSchema).min(1).max(100)
});

// Good: Structured logging
logger.info('Quote created', { quoteId: id, userId: req.user.id });
```

## Security Features

### Implemented
- **Helmet.js**: Security headers (CSP, HSTS, etc.)
- **Rate Limiting**: 
  - Auth endpoints: 5 attempts per 15 minutes
  - API: 60 requests per minute
  - General: 100 requests per 15 minutes
- **Input Validation**: Zod schemas for all inputs
- **CORS**: Configurable origin whitelist
- **Password Security**: bcrypt with cost factor 12, minimum 8 characters
- **JWT Security**: 30-day expiry, production secret validation
- **SQL Injection Prevention**: Prepared statements throughout

### Webhook Security
- Stripe webhooks use raw body parser for signature verification
- Signature verified using `STRIPE_WEBHOOK_SECRET`

## Background Jobs

The follow-up processor runs automatically when the server starts:
- Checks for pending follow-ups every 5 minutes
- Sends emails via configured SMTP
- Updates follow-up status on success/failure

## Testing Strategy

### Manual Testing Checklist

**Auth Flow:**
1. Register with weak password (should fail validation)
2. Register with valid credentials
3. Login with wrong password (generic error)
4. Verify `/api/v1/auth/me` returns user data

**Quote Lifecycle:**
1. Create quote with validation errors
2. Create valid quote
3. Verify pagination on dashboard
4. Send quote (triggers follow-up scheduling)
5. Open public link in incognito
6. Verify view tracking
7. Accept quote
8. Verify follow-ups cancelled

**Security:**
1. Test rate limiting (rapid requests)
2. Test CORS with wrong origin
3. Test SQL injection in inputs
4. Verify password reset flow

## Deployment

### Prerequisites
- Node.js 18+
- Persistent disk for SQLite (at `DB_PATH`)
- Environment variables configured

### Railway (Recommended)
1. Push code to GitHub
2. Create Railway project from repo
3. Add **Volume** mounted at `/data`
4. Set environment variables
5. Deploy

### Important Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Generate strong `JWT_SECRET`
- [ ] Configure SMTP for email delivery
- [ ] Set up Stripe keys (test first, then live)
- [ ] Configure webhook endpoint
- [ ] Set `CORS_ORIGIN` to your domain
- [ ] Enable volume/disk persistence
- [ ] Set up log monitoring
- [ ] Test follow-up email delivery

## Common Development Tasks

### Reset Database
```bash
rm data/sentquote.db data/sentquote.db-*
npm start
```

### Test Email Locally
Use [Ethereal Email](https://ethereal.email) for testing:
1. Create ethereal account
2. Set SMTP credentials in `.env`
3. Create and send a quote
4. Check ethereal inbox for follow-up

### Run with Stripe (Local)
```bash
# Terminal 1
npm run dev

# Terminal 2
stripe listen --forward-to localhost:3001/api/v1/billing/webhooks/stripe
```

### Add New API Endpoint
1. Add route in appropriate `server/routes/*.js` file
2. Use `authMiddleware` for authenticated routes
3. Add Zod validation schema in `server/validators/schemas.js`
4. Use `validateBody`/`validateParams` middleware
5. Add logging with `logger.info()`
6. Handle errors with `next(err)`

## Migration Notes

### From v1.0 to v1.1
- Database automatically migrates on startup
- New table: `password_resets`
- New indexes for performance
- API now has `/api/v1/` prefix (legacy routes still work)
- Follow-ups are now actually sent (requires SMTP config)

## Git Commit Guidelines

- Use **imperative mood**: "Add feature" not "Added feature"
- Keep subject line concise (under 50 characters)
- No trailing period in subject
- Group commits by concern (API, DB, UI, docs)

Example: `Fix view count increment on public quote pages`
