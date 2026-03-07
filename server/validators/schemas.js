const { z } = require('zod');

// Auth schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  businessName: z.string().max(100, 'Business name too long').optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password required')
});

// Line item schema
const lineItemSchema = z.object({
  description: z.string().min(1, 'Description required').max(500, 'Description too long'),
  quantity: z.number().int().positive('Quantity must be positive').max(999999, 'Quantity too large'),
  unitPrice: z.number().nonnegative('Price cannot be negative').max(999999999, 'Price too large')
});

// Quote schemas
const createQuoteSchema = z.object({
  clientName: z.string().min(1, 'Client name required').max(200, 'Name too long'),
  clientEmail: z.string().email('Invalid client email'),
  title: z.string().min(1, 'Title required').max(200, 'Title too long'),
  description: z.string().max(5000, 'Description too long').optional(),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item required').max(100, 'Too many line items'),
  taxRate: z.number().min(0).max(100, 'Tax rate must be 0-100').optional(),
  depositPercent: z.number().int().min(0).max(100, 'Deposit must be 0-100').optional(),
  validDays: z.number().int().min(1).max(365, 'Valid days must be 1-365').optional(),
  notes: z.string().max(5000, 'Notes too long').optional()
});

const updateQuoteSchema = createQuoteSchema.partial();

// UUID schema for params
const uuidSchema = z.string().uuid('Invalid ID format');

// Pagination schema
const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20')
}).transform(({ page, limit }) => ({
  page: Math.max(1, page),
  limit: Math.min(100, Math.max(1, limit))
}));

module.exports = {
  registerSchema,
  loginSchema,
  createQuoteSchema,
  updateQuoteSchema,
  lineItemSchema,
  uuidSchema,
  paginationSchema
};
