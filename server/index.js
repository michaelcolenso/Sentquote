require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { generateToken, authMiddleware } = require('./auth');
const { sendQuoteToClient, sendOwnerNotification, sendFollowupEmail } = require('./email');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Stripe setup
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Rate limiting
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

app.use(cors());
app.use(express.json());

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '..', 'public')));

// =====================
// FREE QUOTA MIDDLEWARE
// =====================
function enforceFreeQuota(req, res, next) {
  const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id);
  if (user && user.plan === 'pro') return next();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = db.prepare(
    "SELECT COUNT(*) as count FROM quotes WHERE user_id = ? AND created_at >= ?"
  ).get(req.user.id, startOfMonth.toISOString());

  if (count >= 5) {
    return res.status(403).json({
      error: 'Free plan limit reached (5 quotes/month). Upgrade to Pro for unlimited quotes.',
      upgrade: true,
    });
  }
  next();
}

// =====================
// AUTH ROUTES
// =====================
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, businessName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);

    db.prepare(
      'INSERT INTO users (id, email, password_hash, business_name) VALUES (?, ?, ?, ?)'
    ).run(id, email.toLowerCase(), password_hash, businessName || '');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(user);

    res.json({ token, user: { id: user.id, email: user.email, businessName: user.business_name, plan: user.plan } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, businessName: user.business_name, plan: user.plan } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, business_name, plan, stripe_connected, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, businessName: user.business_name, stripeConnected: !!user.stripe_connected } });
});

// =====================
// QUOTES ROUTES
// =====================

function generateSlug() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let slug = '';
  for (let i = 0; i < 8; i++) slug += chars[Math.floor(Math.random() * chars.length)];
  return slug;
}

// List quotes for authenticated user
app.get('/api/quotes', authMiddleware, (req, res) => {
  const quotes = db.prepare(
    'SELECT * FROM quotes WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  res.json({ quotes: quotes.map(q => ({ ...q, lineItems: JSON.parse(q.line_items) })) });
});

// Create a new quote (enforces free tier quota)
app.post('/api/quotes', authMiddleware, enforceFreeQuota, (req, res) => {
  try {
    const { clientName, clientEmail, title, description, lineItems, taxRate, depositPercent, validDays, notes } = req.body;

    if (!clientName || !clientEmail || !title || !lineItems?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    const slug = generateSlug();
    const subtotal = lineItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0);
    const taxAmt = Math.round(subtotal * (taxRate || 0) / 100);
    const total = subtotal + taxAmt;
    const depositAmt = depositPercent ? Math.round(total * depositPercent / 100) : 0;
    const validUntil = validDays ? new Date(Date.now() + validDays * 86400000).toISOString() : null;

    db.prepare(`
      INSERT INTO quotes (id, user_id, slug, client_name, client_email, title, description, line_items, subtotal, tax_rate, tax_amount, total, deposit_percent, deposit_amount, valid_until, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(id, req.user.id, slug, clientName, clientEmail, title, description || '', JSON.stringify(lineItems), subtotal, taxRate || 0, taxAmt, total, depositPercent || 0, depositAmt, validUntil, notes || '');

    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
    res.json({ quote: { ...quote, lineItems: JSON.parse(quote.line_items) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// Get single quote (authenticated)
app.get('/api/quotes/:id', authMiddleware, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const events = db.prepare('SELECT * FROM quote_events WHERE quote_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);

  res.json({ quote: { ...quote, lineItems: JSON.parse(quote.line_items) }, events });
});

// Send quote (change status to sent + email client)
app.post('/api/quotes/:id/send', authMiddleware, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  db.prepare("UPDATE quotes SET status = 'sent', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  // Log event
  db.prepare("INSERT INTO quote_events (quote_id, event_type) VALUES (?, 'sent')").run(req.params.id);

  // Schedule auto follow-ups (3 days and 7 days)
  const now = new Date();
  const threeDay = new Date(now.getTime() + 3 * 86400000).toISOString();
  const sevenDay = new Date(now.getTime() + 7 * 86400000).toISOString();

  db.prepare("INSERT INTO followups (quote_id, scheduled_at, message) VALUES (?, ?, 'Just checking in on the quote I sent — happy to answer any questions!')").run(req.params.id, threeDay);
  db.prepare("INSERT INTO followups (quote_id, scheduled_at, message) VALUES (?, ?, 'Wanted to make sure you saw my quote before it expires. Let me know if you need any changes!')").run(req.params.id, sevenDay);

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);

  // Email quote to client (non-blocking)
  sendQuoteToClient(updated, user, BASE_URL).catch(err => console.error('[email error]', err));

  res.json({ quote: { ...updated, lineItems: JSON.parse(updated.line_items) } });
});

// Update quote
app.put('/api/quotes/:id', authMiddleware, (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const { clientName, clientEmail, title, description, lineItems, taxRate, depositPercent, validDays, notes } = req.body;

  const subtotal = lineItems ? lineItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0) : quote.subtotal;
  const taxAmt = lineItems ? Math.round(subtotal * (taxRate ?? quote.tax_rate) / 100) : quote.tax_amount;
  const total = subtotal + taxAmt;
  const depositAmt = depositPercent !== undefined ? Math.round(total * depositPercent / 100) : quote.deposit_amount;

  db.prepare(`
    UPDATE quotes SET
      client_name = COALESCE(?, client_name),
      client_email = COALESCE(?, client_email),
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      line_items = COALESCE(?, line_items),
      subtotal = ?,
      tax_rate = COALESCE(?, tax_rate),
      tax_amount = ?,
      total = ?,
      deposit_percent = COALESCE(?, deposit_percent),
      deposit_amount = ?,
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    clientName, clientEmail, title, description,
    lineItems ? JSON.stringify(lineItems) : null,
    subtotal, taxRate, taxAmt, total, depositPercent, depositAmt, notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  res.json({ quote: { ...updated, lineItems: JSON.parse(updated.line_items) } });
});

// Delete quote
app.delete('/api/quotes/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM quote_events WHERE quote_id = ?').run(req.params.id);
  db.prepare('DELETE FROM followups WHERE quote_id = ?').run(req.params.id);
  db.prepare('DELETE FROM quotes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Clone quote (creates a draft copy)
app.post('/api/quotes/:id/clone', authMiddleware, (req, res) => {
  const original = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!original) return res.status(404).json({ error: 'Quote not found' });

  const newId = uuidv4();
  let newSlug = generateSlug();
  // Ensure slug uniqueness
  while (db.prepare('SELECT id FROM quotes WHERE slug = ?').get(newSlug)) {
    newSlug = generateSlug();
  }

  db.prepare(`
    INSERT INTO quotes (id, user_id, slug, client_name, client_email, title, description, line_items,
      subtotal, tax_rate, tax_amount, total, currency, deposit_percent, deposit_amount,
      valid_until, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(
    newId, original.user_id, newSlug,
    original.client_name, original.client_email,
    'Copy of ' + original.title,
    original.description, original.line_items,
    original.subtotal, original.tax_rate, original.tax_amount, original.total,
    original.currency, original.deposit_percent, original.deposit_amount,
    original.valid_until, original.notes
  );

  const cloned = db.prepare('SELECT * FROM quotes WHERE id = ?').get(newId);
  res.json({ quote: { ...cloned, lineItems: JSON.parse(cloned.line_items) } });
});

// =====================
// PUBLIC QUOTE ROUTES (client-facing)
// =====================

// View quote by slug (public)
app.get('/api/public/quotes/:slug', (req, res) => {
  const quote = db.prepare(`
    SELECT q.*, u.business_name, u.email as sender_email, u.id as owner_id
    FROM quotes q JOIN users u ON q.user_id = u.id
    WHERE q.slug = ? AND q.status != 'draft'
  `).get(req.params.slug);

  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const isFirstView = quote.view_count === 0;

  // Track view
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE quotes SET
      view_count = view_count + 1,
      first_viewed_at = COALESCE(first_viewed_at, ?),
      last_viewed_at = ?
    WHERE id = ?
  `).run(now, now, quote.id);

  db.prepare("INSERT INTO quote_events (quote_id, event_type, ip_address, user_agent) VALUES (?, 'viewed', ?, ?)").run(
    quote.id,
    req.ip || req.headers['x-forwarded-for'] || 'unknown',
    req.headers['user-agent'] || 'unknown'
  );

  // Notify owner on first view only (avoid spam on repeat opens)
  if (isFirstView) {
    const owner = { email: quote.sender_email, business_name: quote.business_name };
    sendOwnerNotification('viewed', quote, owner, BASE_URL).catch(err => console.error('[email error]', err));
  }

  res.json({
    quote: {
      id: quote.id,
      slug: quote.slug,
      businessName: quote.business_name,
      senderEmail: quote.sender_email,
      clientName: quote.client_name,
      title: quote.title,
      description: quote.description,
      lineItems: JSON.parse(quote.line_items),
      subtotal: quote.subtotal,
      taxRate: quote.tax_rate,
      taxAmount: quote.tax_amount,
      total: quote.total,
      depositPercent: quote.deposit_percent,
      depositAmount: quote.deposit_amount,
      currency: quote.currency,
      validUntil: quote.valid_until,
      status: quote.status,
      notes: quote.notes,
      createdAt: quote.created_at
    }
  });
});

// Accept quote (client action)
app.post('/api/public/quotes/:slug/accept', (req, res) => {
  const quote = db.prepare("SELECT * FROM quotes WHERE slug = ? AND status = 'sent'").get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found or already accepted' });

  db.prepare("UPDATE quotes SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(quote.id);
  db.prepare("INSERT INTO quote_events (quote_id, event_type) VALUES (?, 'accepted')").run(quote.id);

  // Cancel pending followups
  db.prepare("UPDATE followups SET status = 'cancelled' WHERE quote_id = ? AND status = 'pending'").run(quote.id);

  // Notify owner
  const owner = db.prepare('SELECT email, business_name FROM users WHERE id = ?').get(quote.user_id);
  if (owner) {
    sendOwnerNotification('accepted', quote, owner, BASE_URL).catch(err => console.error('[email error]', err));
  }

  res.json({ ok: true, message: 'Quote accepted!' });
});

// =====================
// STRIPE PAYMENT ROUTES
// =====================

// Create Stripe Checkout session for deposit payment
app.post('/api/public/quotes/:slug/pay', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });

  const quote = db.prepare(`
    SELECT q.*, u.stripe_account_id, u.business_name
    FROM quotes q JOIN users u ON q.user_id = u.id
    WHERE q.slug = ? AND q.status IN ('sent', 'accepted')
  `).get(req.params.slug);

  if (!quote) return res.status(404).json({ error: 'Quote not available for payment' });

  const payAmount = quote.deposit_amount > 0 ? quote.deposit_amount : quote.total;

  try {
    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: quote.currency || 'usd',
          product_data: {
            name: `${quote.title}${quote.deposit_amount > 0 ? ' (Deposit)' : ''}`,
            description: `Quote from ${quote.business_name || 'SentQuote'}`,
          },
          unit_amount: payAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${BASE_URL}/q/${quote.slug}?paid=true`,
      cancel_url: `${BASE_URL}/q/${quote.slug}?cancelled=true`,
      metadata: {
        quote_id: quote.id,
        quote_slug: quote.slug,
      },
      customer_email: quote.client_email,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment setup failed' });
  }
});

// Stripe webhook
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(200).send();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const quoteId = session.metadata?.quote_id;
    if (quoteId) {
      db.prepare(`
        UPDATE quotes SET
          status = 'paid',
          paid_at = datetime('now'),
          paid_amount = ?,
          stripe_payment_intent = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(session.amount_total, session.payment_intent, quoteId);

      db.prepare("INSERT INTO quote_events (quote_id, event_type, metadata) VALUES (?, 'paid', ?)").run(
        quoteId, JSON.stringify({ amount: session.amount_total, paymentIntent: session.payment_intent })
      );

      db.prepare("UPDATE followups SET status = 'cancelled' WHERE quote_id = ? AND status = 'pending'").run(quoteId);

      // Notify owner of payment
      const paidQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
      if (paidQuote) {
        const owner = db.prepare('SELECT email, business_name FROM users WHERE id = ?').get(paidQuote.user_id);
        if (owner) {
          sendOwnerNotification('paid', paidQuote, owner, BASE_URL).catch(err => console.error('[email error]', err));
        }
      }
    }
  }

  // Handle subscription lifecycle to enforce plan gating
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    if (sub.status === 'active' && sub.metadata?.user_id) {
      db.prepare("UPDATE users SET plan = 'pro', updated_at = datetime('now') WHERE id = ?")
        .run(sub.metadata.user_id);
      console.log(`[billing] User ${sub.metadata.user_id} upgraded to pro`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    if (sub.metadata?.user_id) {
      db.prepare("UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?")
        .run(sub.metadata.user_id);
      console.log(`[billing] User ${sub.metadata.user_id} downgraded to free`);
    }
  }

  res.status(200).json({ received: true });
});

// =====================
// DASHBOARD STATS
// =====================
app.get('/api/stats', authMiddleware, (req, res) => {
  const userId = req.user.id;

  const totalQuotes = db.prepare('SELECT COUNT(*) as count FROM quotes WHERE user_id = ?').get(userId).count;
  const sentQuotes = db.prepare("SELECT COUNT(*) as count FROM quotes WHERE user_id = ? AND status IN ('sent', 'accepted', 'paid')").get(userId).count;
  const acceptedQuotes = db.prepare("SELECT COUNT(*) as count FROM quotes WHERE user_id = ? AND status IN ('accepted', 'paid')").get(userId).count;
  const paidQuotes = db.prepare("SELECT COUNT(*) as count FROM quotes WHERE user_id = ? AND status = 'paid'").get(userId).count;
  const totalViews = db.prepare('SELECT COALESCE(SUM(view_count), 0) as count FROM quotes WHERE user_id = ?').get(userId).count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(paid_amount), 0) as total FROM quotes WHERE user_id = ? AND status = 'paid'").get(userId).total;
  const recentEvents = db.prepare(`
    SELECT qe.*, q.client_name, q.title
    FROM quote_events qe
    JOIN quotes q ON qe.quote_id = q.id
    WHERE q.user_id = ?
    ORDER BY qe.created_at DESC
    LIMIT 20
  `).all(userId);

  res.json({
    stats: {
      totalQuotes, sentQuotes, acceptedQuotes, paidQuotes, totalViews, totalRevenue
    },
    recentEvents
  });
});

// =====================
// STRIPE CONNECT (for receiving payments)
// =====================
app.post('/api/stripe/connect', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const account = await stripe.accounts.create({ type: 'express' });
    db.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').run(account.id, req.user.id);

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${BASE_URL}/dashboard/settings`,
      return_url: `${BASE_URL}/dashboard/settings?stripe=connected`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to setup Stripe' });
  }
});

// =====================
// SUBSCRIPTION / BILLING
// =====================
app.post('/api/billing/checkout', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'SentQuote Pro',
            description: 'Unlimited quotes, payment collection, auto follow-ups',
          },
          unit_amount: 2900,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${BASE_URL}/dashboard?upgraded=true`,
      cancel_url: `${BASE_URL}/dashboard`,
      customer_email: user.email,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// =====================
// SPA FALLBACK
// =====================
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 SentQuote server running on port ${PORT}`);
  startFollowupScheduler();
});

// =====================
// FOLLOW-UP EMAIL SCHEDULER
// =====================
function startFollowupScheduler() {
  if (!process.env.SMTP_HOST) {
    console.log('[scheduler] SMTP not configured — follow-up scheduler disabled');
    return;
  }

  async function runScheduler() {
    try {
      const due = db.prepare(`
        SELECT f.*, q.client_email, q.client_name, q.title, q.slug, q.status, q.total,
               u.email as owner_email, u.business_name, u.id as owner_id
        FROM followups f
        JOIN quotes q ON f.quote_id = q.id
        JOIN users u ON q.user_id = u.id
        WHERE f.status = 'pending'
          AND f.scheduled_at <= datetime('now')
          AND q.status = 'sent'
      `).all();

      for (const row of due) {
        const followup = { id: row.id, message: row.message };
        const quote = {
          id: row.quote_id, client_email: row.client_email, client_name: row.client_name,
          title: row.title, slug: row.slug, total: row.total,
        };
        const user = { email: row.owner_email, business_name: row.business_name };

        try {
          await sendFollowupEmail(followup, quote, user, BASE_URL);
          db.prepare("UPDATE followups SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(row.id);
          db.prepare("INSERT INTO quote_events (quote_id, event_type) VALUES (?, 'followup_sent')").run(row.quote_id);
          console.log(`[scheduler] Follow-up sent for quote ${row.quote_id}`);
        } catch (err) {
          console.error(`[scheduler] Failed to send follow-up ${row.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[scheduler] Error:', err.message);
    }
  }

  // Run immediately on startup, then every 5 minutes
  runScheduler();
  setInterval(runScheduler, 5 * 60 * 1000);
  console.log('[scheduler] Follow-up scheduler started (runs every 5 minutes)');
}

module.exports = app;
