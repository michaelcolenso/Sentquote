const express = require('express');
const db = require('../db');
const stripeService = require('../services/stripe');
const followupService = require('../services/followups');
const emailService = require('../services/email');
const logger = require('../utils/logger');
const { z } = require('zod');
const { validateParams } = require('../middleware/validator');

const router = express.Router();

const slugSchema = z.string().regex(/^[a-z0-9]{8,12}$/, 'Invalid quote slug');

// In-memory rate limiting for notifications: quoteId -> timestamp
const lastNotificationSent = new Map();

// Clean up old entries every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [quoteId, timestamp] of lastNotificationSent.entries()) {
    if (timestamp < oneHourAgo) {
      lastNotificationSent.delete(quoteId);
    }
  }
}, 60 * 60 * 1000);

// Helper: Check if we should send notification (rate limiting)
function shouldSendNotification(quoteId, minIntervalMinutes) {
  const lastSent = lastNotificationSent.get(quoteId);
  const now = Date.now();
  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  
  if (!lastSent || (now - lastSent) > minIntervalMs) {
    lastNotificationSent.set(quoteId, now);
    return true;
  }
  return false;
}

// View public quote
router.get('/quotes/:slug', validateParams(z.object({ slug: slugSchema })), (req, res, next) => {
  try {
    const quote = db.prepare(`
      SELECT q.*, u.business_name, u.email as sender_email
      FROM quotes q JOIN users u ON q.user_id = u.id
      WHERE q.slug = ? AND q.status != 'draft'
    `).get(req.params.slug);

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Check if quote has expired
    if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
      // Update status to expired
      db.prepare("UPDATE quotes SET status = 'expired' WHERE id = ?").run(quote.id);
      return res.status(410).json({ error: 'Quote has expired' });
    }

    // Track view
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE quotes SET
        view_count = view_count + 1,
        first_viewed_at = COALESCE(first_viewed_at, ?),
        last_viewed_at = ?
      WHERE id = ?
    `).run(now, now, quote.id);

    db.prepare(`
      INSERT INTO quote_events (quote_id, event_type, ip_address, user_agent) 
      VALUES (?, 'viewed', ?, ?)
    `).run(
      quote.id,
      req.ip || req.headers['x-forwarded-for'] || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Get updated view count
    const updatedQuote = db.prepare('SELECT view_count FROM quotes WHERE id = ?').get(quote.id);

    // Send notification to quote owner (async, don't block response)
    try {
      const settings = db.prepare(`
        SELECT notify_on_view, min_view_interval_minutes 
        FROM user_settings 
        WHERE user_id = ?
      `).get(quote.user_id);
      
      const notifyOnView = settings?.notify_on_view !== 0; // Default to true
      const minInterval = settings?.min_view_interval_minutes || 60;
      
      if (notifyOnView && shouldSendNotification(quote.id, minInterval)) {
        const user = db.prepare('SELECT email, business_name FROM users WHERE id = ?').get(quote.user_id);
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        
        emailService.sendViewNotificationEmail({
          to: user.email,
          businessName: user.business_name || 'There',
          clientName: quote.client_name,
          quoteTitle: quote.title,
          quoteUrl: `${baseUrl}/quotes/${quote.id}`,
          viewCount: updatedQuote.view_count
        }).catch(err => {
          logger.error('Failed to send view notification', { error: err.message, quoteId: quote.id });
        });
      }
    } catch (err) {
      // Don't let notification errors break the view tracking
      logger.error('Error checking notification settings', { error: err.message });
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
        viewCount: updatedQuote?.view_count || 0,
        createdAt: quote.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Accept quote
router.post('/quotes/:slug/accept', validateParams(z.object({ slug: slugSchema })), (req, res, next) => {
  try {
    const quote = db.prepare("SELECT * FROM quotes WHERE slug = ? AND status = 'sent'").get(req.params.slug);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or already accepted' });
    }

    // Check expiration
    if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
      return res.status(410).json({ error: 'Quote has expired' });
    }

    // Use transaction
    const acceptQuote = db.transaction(() => {
      db.prepare(`
        UPDATE quotes 
        SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') 
        WHERE id = ?
      `).run(quote.id);

      db.prepare("INSERT INTO quote_events (quote_id, event_type) VALUES (?, 'accepted')").run(quote.id);

      // Cancel pending followups
      followupService.cancelFollowups(quote.id);
    });

    acceptQuote();

    // Send notification to quote owner (async)
    try {
      const settings = db.prepare('SELECT notify_on_accept FROM user_settings WHERE user_id = ?').get(quote.user_id);
      const notifyOnAccept = settings?.notify_on_accept !== 0; // Default to true
      
      if (notifyOnAccept) {
        const user = db.prepare('SELECT email, business_name FROM users WHERE id = ?').get(quote.user_id);
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        
        emailService.sendAcceptNotificationEmail({
          to: user.email,
          businessName: user.business_name || 'There',
          clientName: quote.client_name,
          quoteTitle: quote.title,
          quoteUrl: `${baseUrl}/quotes/${quote.id}`
        }).catch(err => {
          logger.error('Failed to send accept notification', { error: err.message, quoteId: quote.id });
        });
      }
    } catch (err) {
      logger.error('Error sending accept notification', { error: err.message });
    }

    logger.info('Quote accepted', { quoteId: quote.id, slug: req.params.slug });

    res.json({ ok: true, message: 'Quote accepted!' });
  } catch (err) {
    next(err);
  }
});

// Create payment session
router.post('/quotes/:slug/pay', validateParams(z.object({ slug: slugSchema })), async (req, res, next) => {
  try {
    const quote = db.prepare(`
      SELECT q.*, u.stripe_account_id, u.business_name
      FROM quotes q JOIN users u ON q.user_id = u.id
      WHERE q.slug = ? AND q.status IN ('sent', 'accepted')
    `).get(req.params.slug);

    if (!quote) {
      return res.status(404).json({ error: 'Quote not available for payment' });
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    const session = await stripeService.createCheckoutSession({
      quote: {
        ...quote,
        business_name: quote.business_name,
        stripe_account_id: quote.stripe_account_id
      },
      baseUrl
    });

    logger.info('Payment session created', { sessionId: session.id, quoteId: quote.id });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
