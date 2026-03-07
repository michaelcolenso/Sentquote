const { z } = require('zod');

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues || err.errors || [];
        return res.status(400).json({
          error: 'Validation failed',
          details: issues.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      next(err);
    }
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    try {
      req.params = { ...req.params, ...schema.parse(req.params) };
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues || err.errors || [];
        return res.status(400).json({
          error: 'Invalid parameters',
          details: issues.map(e => e.message)
        });
      }
      next(err);
    }
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues || err.errors || [];
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: issues.map(e => e.message)
        });
      }
      next(err);
    }
  };
}

module.exports = { validateBody, validateParams, validateQuery };
