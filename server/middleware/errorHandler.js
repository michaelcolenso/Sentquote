const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // Generate request ID for tracking
  const requestId = req.id || 'unknown';
  
  logger.error(`${err.name}: ${err.message}`);

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || [];
    return res.status(400).json({
      error: 'Validation failed',
      details: issues.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    });
  }

  // Handle specific error types
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(400).json({ error: 'Referenced resource not found' });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(statusCode).json({
    error: message,
    requestId: process.env.NODE_ENV === 'production' ? requestId : undefined
  });
}

module.exports = errorHandler;
