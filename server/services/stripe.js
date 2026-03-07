const logger = require('../utils/logger');

let stripe = null;

function initializeStripe() {
  if (stripe) return stripe;
  
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    logger.info('Stripe initialized');
  } else {
    logger.warn('Stripe not configured - payments disabled');
  }
  
  return stripe;
}

async function createCheckoutSession({ quote, baseUrl }) {
  const stripeInstance = initializeStripe();
  if (!stripeInstance) {
    throw new Error('Payments not configured');
  }

  const payAmount = quote.deposit_amount > 0 ? quote.deposit_amount : quote.total;
  
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
    success_url: `${baseUrl}/q/${quote.slug}?paid=true`,
    cancel_url: `${baseUrl}/q/${quote.slug}?cancelled=true`,
    metadata: {
      quote_id: quote.id,
      quote_slug: quote.slug,
    },
    customer_email: quote.client_email,
  };

  // Add Stripe Connect account if available
  if (quote.stripe_account_id) {
    sessionParams.payment_intent_data = {
      transfer_data: {
        destination: quote.stripe_account_id,
      },
    };
  }

  const session = await stripeInstance.checkout.sessions.create(sessionParams);
  logger.info('Checkout session created', { sessionId: session.id, quoteId: quote.id });
  
  return session;
}

async function constructWebhookEvent(body, signature) {
  const stripeInstance = initializeStripe();
  if (!stripeInstance) return null;

  if (process.env.STRIPE_WEBHOOK_SECRET) {
    return stripeInstance.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }
  
  return JSON.parse(body);
}

async function createExpressAccount() {
  const stripeInstance = initializeStripe();
  if (!stripeInstance) {
    throw new Error('Stripe not configured');
  }

  const account = await stripeInstance.accounts.create({ type: 'express' });
  logger.info('Stripe Express account created', { accountId: account.id });
  
  return account;
}

async function createAccountLink(accountId, refreshUrl, returnUrl) {
  const stripeInstance = initializeStripe();
  
  const accountLink = await stripeInstance.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return accountLink;
}

async function createSubscriptionCheckout({ user, baseUrl }) {
  const stripeInstance = initializeStripe();
  if (!stripeInstance) {
    throw new Error('Stripe not configured');
  }

  const session = await stripeInstance.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'SentQuote Pro',
          description: 'Unlimited quotes, payment collection, auto follow-ups',
        },
        unit_amount: 2900, // $29/month
        recurring: { interval: 'month' },
      },
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: `${baseUrl}/dashboard?upgraded=true`,
    cancel_url: `${baseUrl}/dashboard/settings`,
    customer_email: user.email,
    metadata: { user_id: user.id },
  });

  return session;
}

module.exports = {
  initializeStripe,
  createCheckoutSession,
  constructWebhookEvent,
  createExpressAccount,
  createAccountLink,
  createSubscriptionCheckout
};
