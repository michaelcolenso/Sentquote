const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../auth');
const stripeService = require('../services/stripe');
const emailService = require('../services/email');
const logger = require('../utils/logger');

const router = express.Router();

// Connect Stripe account
router.post('/stripe/connect', authMiddleware, async (req, res, next) => {
  try {
    const account = await stripeService.createExpressAccount();
    
    db.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').run(
      account.id, 
      req.user.id
    );

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const accountLink = await stripeService.createAccountLink(
      account.id,
      `${baseUrl}/dashboard/settings`,
      `${baseUrl}/dashboard/settings?stripe=connected`
    );

    logger.info('Stripe connect initiated', { userId: req.user.id, accountId: account.id });

    res.json({ url: accountLink.url });
  } catch (err) {
    next(err);
  }
});

// Create subscription checkout
router.post('/checkout', authMiddleware, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    const session = await stripeService.createSubscriptionCheckout({ user, baseUrl });

    logger.info('Subscription checkout created', { userId: user.id, sessionId: session.id });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// Stripe webhook
router.post('/webhooks/stripe', async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = await stripeService.constructWebhookEvent(req.body, sig);

    if (!event) {
      return res.status(400).send('Webhook processing failed');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const quoteId = session.metadata?.quote_id;
      
      if (quoteId) {
        // Use transaction
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

          // Cancel followups
          db.prepare(`
            UPDATE followups 
            SET status = 'cancelled' 
            WHERE quote_id = ? AND status = 'pending'
          `).run(quoteId);
        });

        processPayment();

        // Send payment notification (async)
        try {
          const quote = db.prepare(`
            SELECT q.*, u.email as user_email, u.business_name 
            FROM quotes q 
            JOIN users u ON q.user_id = u.id 
            WHERE q.id = ?
          `).get(quoteId);
          
          if (quote) {
            const settings = db.prepare('SELECT notify_on_pay FROM user_settings WHERE user_id = ?').get(quote.user_id);
            const notifyOnPay = settings?.notify_on_pay !== 0; // Default to true
            
            if (notifyOnPay) {
              emailService.sendPaymentNotificationEmail({
                to: quote.user_email,
                businessName: quote.business_name || 'There',
                clientName: quote.client_name,
                quoteTitle: quote.title,
                amount: session.amount_total
              }).catch(err => {
                logger.error('Failed to send payment notification', { error: err.message, quoteId });
              });
            }
          }
        } catch (err) {
          logger.error('Error sending payment notification', { error: err.message });
        }

        logger.info('Payment processed', { quoteId, amount: session.amount_total });
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
