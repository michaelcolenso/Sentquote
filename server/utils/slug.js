const db = require('../db');

const SLUG_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 8;
const MAX_ATTEMPTS = 10;

function generateRandomSlug() {
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return slug;
}

function generateUniqueSlug() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const slug = generateRandomSlug();
    
    // Check if slug exists
    const existing = db.prepare('SELECT id FROM quotes WHERE slug = ?').get(slug);
    if (!existing) {
      return slug;
    }
  }
  
  // Fallback: add timestamp to ensure uniqueness
  const timestamp = Date.now().toString(36).slice(-4);
  const baseSlug = generateRandomSlug().slice(0, 4);
  return baseSlug + timestamp;
}

module.exports = { generateRandomSlug, generateUniqueSlug };
