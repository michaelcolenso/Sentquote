const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sentquote-dev-secret-change-in-production';

// Fail fast in production if JWT_SECRET is not properly configured
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long in production');
  }
  if (process.env.JWT_SECRET.includes('dev-secret') || process.env.JWT_SECRET.includes('default')) {
    throw new Error('JWT_SECRET cannot use default/dev value in production');
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { generateToken, authMiddleware, JWT_SECRET };
