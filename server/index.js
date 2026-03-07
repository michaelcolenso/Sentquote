require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');

const db = require('./db');
const logger = require('./utils/logger');
const requestIdMiddleware = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const followupService = require('./services/followups');
const emailService = require('./services/email');

// Route imports
const authRoutes = require('./routes/auth');
const quoteRoutes = require('./routes/quotes');
const publicRoutes = require('./routes/public');
const dashboardRoutes = require('./routes/dashboard');
const billingRoutes = require('./routes/billing');
const templateRoutes = require('./routes/templates');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy if behind reverse proxy (Railway, Render, etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Request ID for tracing
app.use(requestIdMiddleware);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
    }
  },
  crossOriginEmbedderPolicy: false // Allow React CDN
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
};
app.use(cors(corsOptions));

// Rate limiting
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later' },
  skipSuccessfulRequests: true,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Rate limit exceeded' }
});

app.use(standardLimiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`[${req.method}] ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Stripe webhook route must use raw body parser BEFORE global JSON parser
app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Manually handle webhook since it needs raw body
  const sig = req.headers['stripe-signature'];
  const stripeService = require('./services/stripe');
  const db = require('./db');
  const logger = require('./utils/logger');
  
  stripeService.constructWebhookEvent(req.body, sig).then(event => {
    if (!event) {
      return res.status(400).send('Webhook processing failed');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const quoteId = session.metadata?.quote_id;
      
      if (quoteId) {
        const processPayment = db.transaction(() => {
          db.prepare(`
            UPDATE quotes SET
              status = 'paid',
              paid_at = datetime('now'),
              paid_amount = ?,
              stripe_payment_intent = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).run(session.amount_total, session.payment_intent, quoteId);

          db.prepare(`
            INSERT INTO quote_events (quote_id, event_type, metadata) 
            VALUES (?, 'paid', ?)
          `).run(
            quoteId, 
            JSON.stringify({ amount: session.amount_total, paymentIntent: session.payment_intent })
          );

          db.prepare(`
            UPDATE followups 
            SET status = 'cancelled' 
            WHERE quote_id = ? AND status = 'pending'
          `).run(quoteId);
        });

        processPayment();
        logger.info('Payment processed via webhook', { quoteId, amount: session.amount_total });
      }
    }

    res.status(200).json({ received: true });
  }).catch(err => next(err));
});

// Global JSON parser for all other routes
app.use(express.json({ limit: '10mb' }));

// Health check endpoint (before API routes)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1', apiLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/quotes', quoteRoutes);
app.use('/api/v1/templates', templateRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/billing', billingRoutes);

// Legacy API routes (backward compatibility)
app.use('/api/auth', authRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/stats', dashboardRoutes);
app.use('/api', billingRoutes);

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback - must be after API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 SentQuote server running on port ${PORT}`, {
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    dbPath: process.env.DB_PATH || './data/sentquote.db'
  });

  // Initialize services
  emailService.initializeTransporter();
  
  // Start follow-up processor
  followupService.startFollowupProcessor();
});

module.exports = app;
