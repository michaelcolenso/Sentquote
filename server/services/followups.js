const db = require('../db');
const emailService = require('./email');
const logger = require('../utils/logger');

// Process pending follow-ups
async function processFollowups() {
  const now = new Date().toISOString();
  
  // Find follow-ups that should be sent
  const pendingFollowups = db.prepare(`
    SELECT f.*, q.client_email, q.client_name, q.title, q.slug, u.business_name
    FROM followups f
    JOIN quotes q ON f.quote_id = q.id
    JOIN users u ON q.user_id = u.id
    WHERE f.status = 'pending' 
    AND f.scheduled_at <= ?
    AND q.status IN ('sent', 'draft')
  `).all(now);

  logger.info(`Processing ${pendingFollowups.length} follow-ups`);

  for (const followup of pendingFollowups) {
    try {
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      const quoteUrl = `${baseUrl}/q/${followup.slug}`;

      await emailService.sendFollowUpEmail({
        to: followup.client_email,
        clientName: followup.client_name,
        quoteTitle: followup.title,
        quoteUrl,
        message: followup.message
      });

      // Mark as sent
      db.prepare(`
        UPDATE followups 
        SET status = 'sent', sent_at = datetime('now') 
        WHERE id = ?
      `).run(followup.id);

      logger.info('Follow-up sent', { followupId: followup.id, quoteId: followup.quote_id });
    } catch (err) {
      logger.error('Failed to send follow-up', { 
        followupId: followup.id, 
        error: err.message 
      });
      
      // Don't mark as failed, will retry on next run
    }
  }
}

// Schedule follow-ups for a quote
function scheduleFollowups(quoteId) {
  const now = new Date();
  const threeDay = new Date(now.getTime() + 3 * 86400000).toISOString();
  const sevenDay = new Date(now.getTime() + 7 * 86400000).toISOString();

  const insert = db.prepare(`
    INSERT INTO followups (quote_id, scheduled_at, message) 
    VALUES (?, ?, ?)
  `);

  insert.run(
    quoteId, 
    threeDay, 
    'Just checking in on the quote I sent — happy to answer any questions!'
  );
  
  insert.run(
    quoteId, 
    sevenDay, 
    'Wanted to make sure you saw my quote before it expires. Let me know if you need any changes!'
  );

  logger.info('Follow-ups scheduled', { quoteId });
}

// Cancel pending follow-ups
function cancelFollowups(quoteId) {
  db.prepare(`
    UPDATE followups 
    SET status = 'cancelled' 
    WHERE quote_id = ? AND status = 'pending'
  `).run(quoteId);
}

// Start the follow-up processor (runs every 5 minutes)
function startFollowupProcessor() {
  logger.info('Starting follow-up processor');
  
  // Run immediately on start
  processFollowups().catch(err => logger.error('Follow-up processor error', { error: err.message }));
  
  // Then every 5 minutes
  setInterval(() => {
    processFollowups().catch(err => logger.error('Follow-up processor error', { error: err.message }));
  }, 5 * 60 * 1000);
}

module.exports = {
  processFollowups,
  scheduleFollowups,
  cancelFollowups,
  startFollowupProcessor
};
