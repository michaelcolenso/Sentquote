const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validator');
const { createQuoteSchema, updateQuoteSchema, uuidSchema, paginationSchema } = require('../validators/schemas');
const { generateUniqueSlug } = require('../utils/slug');
const followupService = require('../services/followups');
const pdfService = require('../services/pdf');
const logger = require('../utils/logger');

const router = express.Router();

// List quotes with pagination
router.get('/', authMiddleware, validateQuery(paginationSchema), (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const offset = (page - 1) * limit;

    const quotes = db.prepare(`
      SELECT * FROM quotes 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const count = db.prepare('SELECT COUNT(*) as total FROM quotes WHERE user_id = ?').get(req.user.id);

    res.json({
      quotes: quotes.map(q => ({ ...q, lineItems: JSON.parse(q.line_items) })),
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

// Create quote
router.post('/', authMiddleware, validateBody(createQuoteSchema), (req, res, next) => {
  try {
    const { clientName, clientEmail, title, description, lineItems, taxRate, depositPercent, validDays, notes } = req.body;

    const id = uuidv4();
    const slug = generateUniqueSlug();

    // Calculate totals
    const subtotal = lineItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0);
    const taxAmt = Math.round(subtotal * (taxRate || 0) / 100);
    const total = subtotal + taxAmt;
    const depositAmt = depositPercent ? Math.round(total * depositPercent / 100) : 0;
    const validUntil = validDays ? new Date(Date.now() + validDays * 86400000).toISOString() : null;

    // Use transaction for data integrity
    const insertQuote = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotes (
          id, user_id, slug, client_name, client_email, title, description,
          line_items, subtotal, tax_rate, tax_amount, total, deposit_percent,
          deposit_amount, valid_until, notes, status, view_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0)
      `).run(
        id, req.user.id, slug, clientName, clientEmail.toLowerCase(), title, description || '',
        JSON.stringify(lineItems), subtotal, taxRate || 0, taxAmt, total,
        depositPercent || 0, depositAmt, validUntil, notes || ''
      );
    });

    insertQuote();

    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);

    logger.info('Quote created', { quoteId: id, userId: req.user.id });

    res.status(201).json({ quote: { ...quote, lineItems: JSON.parse(quote.line_items) } });
  } catch (err) {
    next(err);
  }
});

// Get single quote
router.get('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), (req, res, next) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const events = db.prepare(`
      SELECT * FROM quote_events 
      WHERE quote_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(req.params.id);

    res.json({
      quote: { ...quote, lineItems: JSON.parse(quote.line_items) },
      events
    });
  } catch (err) {
    next(err);
  }
});

// Send quote
router.post('/:id/send', authMiddleware, validateParams(z.object({ id: uuidSchema })), (req, res, next) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Use transaction
    const sendQuote = db.transaction(() => {
      // Update status
      db.prepare(`
        UPDATE quotes 
        SET status = 'sent', updated_at = datetime('now') 
        WHERE id = ?
      `).run(req.params.id);

      // Log event
      db.prepare("INSERT INTO quote_events (quote_id, event_type) VALUES (?, 'sent')").run(req.params.id);

      // Schedule follow-ups
      followupService.scheduleFollowups(req.params.id);
    });

    sendQuote();

    const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);

    logger.info('Quote sent', { quoteId: req.params.id });

    res.json({ quote: { ...updated, lineItems: JSON.parse(updated.line_items) } });
  } catch (err) {
    next(err);
  }
});

// Update quote
router.put('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), validateBody(updateQuoteSchema), (req, res, next) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Don't allow editing sent/accepted/paid quotes
    if (quote.status !== 'draft') {
      return res.status(400).json({ error: 'Cannot edit sent quotes' });
    }

    const { clientName, clientEmail, title, description, lineItems, taxRate, depositPercent, validDays, notes } = req.body;

    // Recalculate totals if lineItems provided
    let subtotal = quote.subtotal;
    let taxAmt = quote.tax_amount;
    let total = quote.total;
    let depositAmt = quote.deposit_amount;
    let validUntil = quote.valid_until;

    if (lineItems) {
      subtotal = lineItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0);
      taxAmt = Math.round(subtotal * (taxRate ?? quote.tax_rate) / 100);
      total = subtotal + taxAmt;
      depositAmt = depositPercent !== undefined 
        ? Math.round(total * depositPercent / 100) 
        : Math.round(total * quote.deposit_percent / 100);
    }

    if (validDays) {
      validUntil = new Date(Date.now() + validDays * 86400000).toISOString();
    }

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
        valid_until = COALESCE(?, valid_until),
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      clientName, clientEmail, title, description,
      lineItems ? JSON.stringify(lineItems) : null,
      subtotal, taxRate, taxAmt, total, depositPercent, depositAmt, validUntil, notes,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);

    logger.info('Quote updated', { quoteId: req.params.id });

    res.json({ quote: { ...updated, lineItems: JSON.parse(updated.line_items) } });
  } catch (err) {
    next(err);
  }
});

// Delete quote
router.delete('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), (req, res, next) => {
  try {
    // Use transaction to delete related records
    const deleteQuote = db.transaction(() => {
      db.prepare('DELETE FROM quote_events WHERE quote_id = ?').run(req.params.id);
      db.prepare('DELETE FROM followups WHERE quote_id = ?').run(req.params.id);
      db.prepare('DELETE FROM quotes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    });

    deleteQuote();

    logger.info('Quote deleted', { quoteId: req.params.id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Download quote as PDF
router.get('/:id/pdf', authMiddleware, validateParams(z.object({ id: uuidSchema })), async (req, res, next) => {
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const user = db.prepare('SELECT business_name FROM users WHERE id = ?').get(req.user.id);
    
    const pdfBuffer = await pdfService.generateQuotePDF(
      { ...quote, lineItems: JSON.parse(quote.line_items) },
      { businessName: user.business_name }
    );

    const filename = `quote-${quote.slug}-${quote.client_name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    logger.info('Quote PDF generated', { quoteId: req.params.id });
    
    res.send(pdfBuffer);
  } catch (err) {
    logger.error('PDF generation failed', { error: err.message, quoteId: req.params.id });
    next(err);
  }
});

module.exports = router;
