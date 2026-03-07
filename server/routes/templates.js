const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../auth');
const { validateBody, validateParams } = require('../middleware/validator');
const logger = require('../utils/logger');

const router = express.Router();

const uuidSchema = z.string().uuid('Invalid template ID');

const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(9999),
  unitPrice: z.number().min(0).max(1000000)
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  lineItems: z.array(lineItemSchema).min(1).max(100),
  taxRate: z.number().min(0).max(100).optional(),
  depositPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(2000).optional()
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  lineItems: z.array(lineItemSchema).min(1).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  depositPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(2000).optional()
});

// List templates
router.get('/', authMiddleware, (req, res, next) => {
  try {
    const templates = db.prepare(`
      SELECT id, name, description, line_items, tax_rate, deposit_percent, notes, created_at
      FROM templates
      WHERE user_id = ?
      ORDER BY name ASC
    `).all(req.user.id);

    res.json({
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        lineItems: JSON.parse(t.line_items),
        taxRate: t.tax_rate,
        depositPercent: t.deposit_percent,
        notes: t.notes,
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Create template
router.post('/', authMiddleware, validateBody(createTemplateSchema), (req, res, next) => {
  try {
    const { name, description, lineItems, taxRate, depositPercent, notes } = req.body;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO templates (id, user_id, name, description, line_items, tax_rate, deposit_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.user.id,
      name,
      description || '',
      JSON.stringify(lineItems),
      taxRate || 0,
      depositPercent || 50,
      notes || ''
    );

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);

    logger.info('Template created', { templateId: id, userId: req.user.id });

    res.status(201).json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        lineItems: JSON.parse(template.line_items),
        taxRate: template.tax_rate,
        depositPercent: template.deposit_percent,
        notes: template.notes,
        createdAt: template.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Get single template
router.get('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), (req, res, next) => {
  try {
    const template = db.prepare(`
      SELECT id, name, description, line_items, tax_rate, deposit_percent, notes, created_at
      FROM templates
      WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        lineItems: JSON.parse(template.line_items),
        taxRate: template.tax_rate,
        depositPercent: template.deposit_percent,
        notes: template.notes,
        createdAt: template.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Update template
router.put('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), validateBody(updateTemplateSchema), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT id FROM templates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const { name, description, lineItems, taxRate, depositPercent, notes } = req.body;

    db.prepare(`
      UPDATE templates SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        line_items = COALESCE(?, line_items),
        tax_rate = COALESCE(?, tax_rate),
        deposit_percent = COALESCE(?, deposit_percent),
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name,
      description,
      lineItems ? JSON.stringify(lineItems) : null,
      taxRate,
      depositPercent,
      notes,
      req.params.id
    );

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);

    logger.info('Template updated', { templateId: req.params.id, userId: req.user.id });

    res.json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        lineItems: JSON.parse(template.line_items),
        taxRate: template.tax_rate,
        depositPercent: template.deposit_percent,
        notes: template.notes,
        createdAt: template.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Delete template
router.delete('/:id', authMiddleware, validateParams(z.object({ id: uuidSchema })), (req, res, next) => {
  try {
    const result = db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    logger.info('Template deleted', { templateId: req.params.id, userId: req.user.id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Save current quote as template
router.post('/from-quote/:quoteId', authMiddleware, validateParams(z.object({ quoteId: uuidSchema })), (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || name.length < 1 || name.length > 200) {
      return res.status(400).json({ error: 'Template name is required (1-200 characters)' });
    }

    const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.quoteId, req.user.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO templates (id, user_id, name, description, line_items, tax_rate, deposit_percent, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.user.id,
      name,
      quote.description || '',
      quote.line_items,
      quote.tax_rate,
      quote.deposit_percent,
      quote.notes
    );

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);

    logger.info('Template created from quote', { templateId: id, quoteId: req.params.quoteId, userId: req.user.id });

    res.status(201).json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        lineItems: JSON.parse(template.line_items),
        taxRate: template.tax_rate,
        depositPercent: template.deposit_percent,
        notes: template.notes,
        createdAt: template.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
