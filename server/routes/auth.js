const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateToken, authMiddleware } = require('../auth');
const { validateBody } = require('../middleware/validator');
const { registerSchema, loginSchema } = require('../validators/schemas');
const emailService = require('../services/email');
const logger = require('../utils/logger');

const router = express.Router();

// Register
router.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, businessName } = req.body;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12); // Increased cost factor

    db.prepare(
      'INSERT INTO users (id, email, password_hash, business_name) VALUES (?, ?, ?, ?)'
    ).run(id, email.toLowerCase(), passwordHash, businessName || '');

    // Create default settings
    db.prepare(
      'INSERT INTO user_settings (user_id) VALUES (?)'
    ).run(id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(user);

    logger.info('User registered', { userId: id, email });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan
      }
    });
  } catch (err) {
    next(err);
  }
});

// Login
router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      // Use same error message to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn('Failed login attempt', { email, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    logger.info('User logged in', { userId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan
      }
    });
  } catch (err) {
    next(err);
  }
});

// Get current user
router.get('/me', authMiddleware, (req, res, next) => {
  try {
    const user = db.prepare(
      'SELECT id, email, business_name, plan, stripe_connected, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        stripeConnected: !!user.stripe_connected,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Request password reset
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      // Return success even if user not found (security)
      return res.json({ message: 'If an account exists, a reset email has been sent' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.prepare(`
      INSERT INTO password_resets (user_id, token, expires_at) 
      VALUES (?, ?, ?)
    `).run(user.id, token, expiresAt);

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await emailService.sendPasswordResetEmail({ to: email, resetUrl });

    res.json({ message: 'If an account exists, a reset email has been sent' });
  } catch (err) {
    next(err);
  }
});

// Get user settings
router.get('/settings', authMiddleware, (req, res, next) => {
  try {
    let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    
    // Create default settings if they don't exist
    if (!settings) {
      db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(req.user.id);
      settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    }

    res.json({
      settings: {
        notifyOnView: !!settings.notify_on_view,
        notifyOnAccept: !!settings.notify_on_accept,
        notifyOnPay: !!settings.notify_on_pay,
        minViewIntervalMinutes: settings.min_view_interval_minutes
      }
    });
  } catch (err) {
    next(err);
  }
});

// Update user settings
router.put('/settings', authMiddleware, (req, res, next) => {
  try {
    const { notifyOnView, notifyOnAccept, notifyOnPay, minViewIntervalMinutes } = req.body;

    // Ensure settings exist
    const existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(req.user.id);
    if (!existing) {
      db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(req.user.id);
    }

    db.prepare(`
      UPDATE user_settings SET
        notify_on_view = ?,
        notify_on_accept = ?,
        notify_on_pay = ?,
        min_view_interval_minutes = ?,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      notifyOnView !== undefined ? (notifyOnView ? 1 : 0) : 1,
      notifyOnAccept !== undefined ? (notifyOnAccept ? 1 : 0) : 1,
      notifyOnPay !== undefined ? (notifyOnPay ? 1 : 0) : 1,
      minViewIntervalMinutes || 60,
      req.user.id
    );

    logger.info('User settings updated', { userId: req.user.id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
