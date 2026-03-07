const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/stats', authMiddleware, (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get pipeline stats
    const totalQuotes = db.prepare('SELECT COUNT(*) as count FROM quotes WHERE user_id = ?').get(userId);
    const sentQuotes = db.prepare(`
      SELECT COUNT(*) as count FROM quotes 
      WHERE user_id = ? AND status IN ('sent', 'accepted', 'paid')
    `).get(userId);
    const acceptedQuotes = db.prepare(`
      SELECT COUNT(*) as count FROM quotes 
      WHERE user_id = ? AND status IN ('accepted', 'paid')
    `).get(userId);
    const paidQuotes = db.prepare(`
      SELECT COUNT(*) as count FROM quotes 
      WHERE user_id = ? AND status = 'paid'
    `).get(userId);
    const totalViews = db.prepare(`
      SELECT COALESCE(SUM(view_count), 0) as count 
      FROM quotes 
      WHERE user_id = ?
    `).get(userId);
    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(paid_amount), 0) as total 
      FROM quotes 
      WHERE user_id = ? AND status = 'paid'
    `).get(userId);

    // Get conversion rate
    const conversionRate = sentQuotes.count > 0 
      ? Math.round((paidQuotes.count / sentQuotes.count) * 100) 
      : 0;

    // Get recent events
    const recentEvents = db.prepare(`
      SELECT qe.*, q.client_name, q.title
      FROM quote_events qe
      JOIN quotes q ON qe.quote_id = q.id
      WHERE q.user_id = ?
      ORDER BY qe.created_at DESC
      LIMIT 20
    `).all(userId);

    // Get quotes needing attention (viewed but not accepted)
    const needsAttention = db.prepare(`
      SELECT id, title, client_name, view_count, last_viewed_at
      FROM quotes
      WHERE user_id = ? AND status = 'sent' AND view_count > 0
      ORDER BY last_viewed_at DESC
      LIMIT 5
    `).all(userId);

    res.json({
      stats: {
        totalQuotes: totalQuotes.count,
        sentQuotes: sentQuotes.count,
        acceptedQuotes: acceptedQuotes.count,
        paidQuotes: paidQuotes.count,
        totalViews: totalViews.count,
        totalRevenue: totalRevenue.total,
        conversionRate
      },
      recentEvents,
      needsAttention
    });
  } catch (err) {
    next(err);
  }
});

// Get activity feed with pagination
router.get('/activity', authMiddleware, (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const events = db.prepare(`
      SELECT qe.*, q.client_name, q.title, q.slug
      FROM quote_events qe
      JOIN quotes q ON qe.quote_id = q.id
      WHERE q.user_id = ?
      ORDER BY qe.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const count = db.prepare(`
      SELECT COUNT(*) as total
      FROM quote_events qe
      JOIN quotes q ON qe.quote_id = q.id
      WHERE q.user_id = ?
    `).get(req.user.id);

    res.json({
      events,
      pagination: {
        page,
        limit,
        total: count.total,
        totalPages: Math.ceil(count.total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
