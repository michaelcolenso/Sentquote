const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create transporter based on environment
let transporter = null;

function initializeTransporter() {
  if (transporter) return transporter;

  // Use SMTP credentials from env
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else if (process.env.NODE_ENV === 'development') {
    // Ethereal for testing in dev
    logger.info('Using Ethereal test email service');
  }

  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const transport = initializeTransporter();
  
  if (!transport) {
    if (process.env.NODE_ENV === 'development') {
      logger.info('Email would be sent (dev mode):', { to, subject });
      return { messageId: 'dev-mode', previewUrl: null };
    }
    throw new Error('Email service not configured');
  }

  try {
    const result = await transport.sendMail({
      from: process.env.FROM_EMAIL || 'noreply@sentquote.com',
      to,
      subject,
      text,
      html
    });

    logger.info('Email sent', { messageId: result.messageId, to });
    return result;
  } catch (err) {
    logger.error('Email send failed', { error: err.message, to });
    throw err;
  }
}

async function sendQuoteNotification({ to, clientName, quoteTitle, quoteUrl }) {
  const subject = `New quote from ${process.env.APP_NAME || 'SentQuote'}`;
  const text = `Hi ${clientName},

You have a new quote: ${quoteTitle}

View it here: ${quoteUrl}

This quote is valid for 30 days.

Best regards`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>New Quote: ${quoteTitle}</h2>
      <p>Hi ${clientName},</p>
      <p>You have a new quote waiting for your review.</p>
      <a href="${quoteUrl}" style="display: inline-block; background: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Quote</a>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">This quote is valid for 30 days.</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendFollowUpEmail({ to, clientName, quoteTitle, quoteUrl, message }) {
  const subject = `Following up: ${quoteTitle}`;
  const text = `Hi ${clientName},

${message}

View your quote: ${quoteUrl}

Best regards`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>${quoteTitle}</h2>
      <p>Hi ${clientName},</p>
      <p>${message}</p>
      <a href="${quoteUrl}" style="display: inline-block; background: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Quote</a>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const subject = 'Reset your password';
  const text = `Reset your password by clicking this link: ${resetUrl}\n\nThis link expires in 1 hour.`;
  
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Reset your password</h2>
      <p>Click the button below to reset your password. This link expires in 1 hour.</p>
      <a href="${resetUrl}" style="display: inline-block; background: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset Password</a>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendViewNotificationEmail({ to, businessName, clientName, quoteTitle, quoteUrl, viewCount }) {
  const subject = `👀 ${clientName} just viewed your quote`;
  const viewText = viewCount === 1 
    ? 'first view' 
    : `view #${viewCount}`;
  
  const text = `Hi ${businessName},

${clientName} just opened your quote "${quoteTitle}" (${viewText}).

This is your chance to follow up while you're top of mind!

View quote details: ${quoteUrl}

— SentQuote`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 48px;">👀</span>
      </div>
      <h2 style="color: #22c55e; margin-bottom: 8px;">${clientName} is looking at your quote</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 24px;">${quoteTitle} · ${viewText}</p>
      
      <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px 0;">This is your chance to follow up while you're top of mind!</p>
        <a href="${quoteUrl}" style="display: inline-block; background: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Quote →</a>
      </div>
      
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        You're receiving this because you have quote view notifications enabled.<br>
        <a href="${process.env.BASE_URL || 'http://localhost:3001'}/dashboard/settings" style="color: #666;">Manage notification settings</a>
      </p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendAcceptNotificationEmail({ to, businessName, clientName, quoteTitle, quoteUrl }) {
  const subject = `✅ ${clientName} accepted your quote!`;
  
  const text = `Great news, ${businessName}!

${clientName} just accepted your quote "${quoteTitle}".

Next step: Wait for payment or follow up to coordinate next steps.

View quote: ${quoteUrl}

— SentQuote`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 48px;">🎉</span>
      </div>
      <h2 style="color: #22c55e; margin-bottom: 8px;">Quote accepted!</h2>
      <p style="margin-bottom: 24px;">${clientName} just accepted <strong>${quoteTitle}</strong>.</p>
      
      <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px 0;">Next step: Wait for payment or follow up to coordinate.</p>
        <a href="${quoteUrl}" style="display: inline-block; background: #22c55e; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Quote →</a>
      </div>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

async function sendPaymentNotificationEmail({ to, businessName, clientName, quoteTitle, amount }) {
  const formattedAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
  const subject = `💰 Payment received: ${formattedAmount}`;
  
  const text = `Cha-ching, ${businessName}!

${clientName} just paid ${formattedAmount} for "${quoteTitle}".

The money is on its way to your Stripe account.

— SentQuote`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 48px;">💰</span>
      </div>
      <h2 style="color: #22c55e; margin-bottom: 8px;">Payment received!</h2>
      <p style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">${formattedAmount}</p>
      <p style="color: #666; margin-bottom: 24px;">from ${clientName} for ${quoteTitle}</p>
      
      <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 20px;">
        <p style="margin: 0;">The money is on its way to your Stripe account. 🎉</p>
      </div>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

module.exports = {
  sendEmail,
  sendQuoteNotification,
  sendFollowUpEmail,
  sendPasswordResetEmail,
  sendViewNotificationEmail,
  sendAcceptNotificationEmail,
  sendPaymentNotificationEmail,
  initializeTransporter
};
