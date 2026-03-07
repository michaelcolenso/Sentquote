const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.SMTP_FROM || 'SentQuote <noreply@sentquote.com>';

function fmtCents(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function emailWrap(bodyHtml, footerText) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#0a0a0b;padding:20px 32px;text-align:center;">
      <span style="color:#fff;font-size:20px;font-weight:700;">⚡ SentQuote</span>
    </div>
    <div style="padding:32px;">${bodyHtml}</div>
    <div style="padding:14px 32px;border-top:1px solid #eee;text-align:center;">
      <p style="margin:0;color:#bbb;font-size:12px;">${footerText}</p>
    </div>
  </div>
</body></html>`;
}

async function sendQuoteToClient(quote, user, baseUrl) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[email] SMTP not configured — skipping sendQuoteToClient');
    return;
  }

  const quoteUrl = `${baseUrl}/q/${quote.slug}`;
  const businessName = user.business_name || 'SentQuote';

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;color:#111;font-weight:700;">${quote.title}</h1>
    <p style="margin:0 0 24px;color:#555;font-size:15px;">Hi ${quote.client_name}, you've received a quote from <strong>${businessName}</strong>.</p>
    ${quote.description ? `<p style="margin:0 0 24px;color:#444;font-size:14px;line-height:1.7;">${quote.description}</p>` : ''}
    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${quote.deposit_amount > 0 ? '10px' : '0'};">
        <span style="color:#666;font-size:14px;">Total</span>
        <span style="font-weight:700;font-size:20px;color:#111;">${fmtCents(quote.total)}</span>
      </div>
      ${quote.deposit_amount > 0 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#22c55e;font-size:14px;">Deposit due (${quote.deposit_percent}%)</span>
        <span style="color:#22c55e;font-weight:600;font-size:14px;">${fmtCents(quote.deposit_amount)}</span>
      </div>` : ''}
      ${quote.valid_until ? `<div style="margin-top:10px;font-size:12px;color:#999;">Valid until ${new Date(quote.valid_until).toLocaleDateString()}</div>` : ''}
    </div>
    <a href="${quoteUrl}" style="display:block;background:#22c55e;color:#000;text-align:center;padding:16px;border-radius:8px;font-weight:700;font-size:16px;text-decoration:none;margin-bottom:20px;">
      View &amp; Accept Quote →
    </a>
    <p style="margin:0;color:#999;font-size:13px;text-align:center;">Or copy this link: <a href="${quoteUrl}" style="color:#22c55e;">${quoteUrl}</a></p>`;

  await transporter.sendMail({
    from: FROM,
    to: quote.client_email,
    subject: `Quote from ${businessName}: ${quote.title} — ${fmtCents(quote.total)}`,
    html: emailWrap(body, `Sent via <a href="https://sentquote.com" style="color:#bbb;">⚡ SentQuote</a>`),
    text: `Hi ${quote.client_name},\n\nYou've received a quote from ${businessName}.\n\n${quote.title}\nTotal: ${fmtCents(quote.total)}\n\nView and accept: ${quoteUrl}`,
  });

  console.log(`[email] Quote sent to client: ${quote.client_email}`);
}

async function sendOwnerNotification(eventType, quote, user, baseUrl) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping owner notification (${eventType})`);
    return;
  }

  const dashboardUrl = `${baseUrl}/quotes/${quote.id}`;
  const events = {
    viewed:   { icon: '👁️', title: 'Quote viewed',       desc: `${quote.client_name} just opened your quote.` },
    accepted: { icon: '✅', title: 'Quote accepted!',     desc: `${quote.client_name} accepted your quote. Time to collect payment!` },
    paid:     { icon: '💰', title: 'Payment received!',   desc: `${quote.client_name} paid ${fmtCents(quote.paid_amount || quote.total)}. Check your Stripe dashboard.` },
  };
  const ev = events[eventType] || { icon: '📬', title: 'Quote update', desc: 'Activity on your quote.' };

  const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:48px;margin-bottom:12px;">${ev.icon}</div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#111;">${ev.title}</h1>
      <p style="margin:0;color:#555;font-size:15px;">${ev.desc}</p>
    </div>
    <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-weight:600;margin-bottom:4px;color:#111;">${quote.title}</div>
      <div style="font-size:13px;color:#666;">${quote.client_name} · ${fmtCents(quote.total)}</div>
    </div>
    <div style="text-align:center;">
      <a href="${dashboardUrl}" style="display:inline-block;background:#22c55e;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;">
        View Quote →
      </a>
    </div>`;

  await transporter.sendMail({
    from: FROM,
    to: user.email,
    subject: `${ev.icon} ${ev.title} — ${quote.title}`,
    html: emailWrap(body, `⚡ SentQuote notification for ${user.email}`),
    text: `${ev.title}\n\n${ev.desc}\n\nQuote: ${quote.title}\nClient: ${quote.client_name}\nAmount: ${fmtCents(quote.total)}\n\nView: ${dashboardUrl}`,
  });

  console.log(`[email] Owner notified (${eventType}): ${user.email}`);
}

async function sendFollowupEmail(followup, quote, user, baseUrl) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[email] SMTP not configured — skipping followup');
    return;
  }

  const quoteUrl = `${baseUrl}/q/${quote.slug}`;
  const businessName = user.business_name || 'SentQuote';

  const body = `
    <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.7;">Hi ${quote.client_name},</p>
    <p style="margin:0 0 24px;color:#333;font-size:15px;line-height:1.7;">${followup.message}</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-weight:600;margin-bottom:4px;color:#111;">${quote.title}</div>
      <div style="font-size:13px;color:#666;">Total: ${fmtCents(quote.total)}</div>
    </div>
    <a href="${quoteUrl}" style="display:block;background:#22c55e;color:#000;text-align:center;padding:16px;border-radius:8px;font-weight:700;font-size:16px;text-decoration:none;">
      View Quote →
    </a>`;

  await transporter.sendMail({
    from: FROM,
    replyTo: user.email,
    to: quote.client_email,
    subject: `Following up: ${quote.title} — ${businessName}`,
    html: emailWrap(body, `Sent via <a href="https://sentquote.com" style="color:#bbb;">⚡ SentQuote</a>`),
    text: `Hi ${quote.client_name},\n\n${followup.message}\n\nView your quote: ${quoteUrl}\n\n— ${businessName}`,
  });

  console.log(`[email] Follow-up sent to: ${quote.client_email}`);
}

module.exports = { sendQuoteToClient, sendOwnerNotification, sendFollowupEmail };
