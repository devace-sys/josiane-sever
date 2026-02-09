import { body, param, query, ValidationChain, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Initialize DOMPurify for server-side sanitization
const window = new JSDOM('').window;
// @ts-ignore - DOMPurify expects browser Window but works with JSDOM
const purify = DOMPurify(window);

/**
 * Input validation and sanitization middleware
 * Prevents XSS, SQL injection, and other injection attacks
 */

// Sanitize HTML and dangerous characters
export const sanitizeHtml = (value: string): string => {
  return purify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
};

// Validation for group creation
export const validateGroupCreate: ValidationChain[] = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Group name must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,!?()]+$/)
    .withMessage('Group name contains invalid characters')
    .customSanitizer(sanitizeHtml),
  body('memberIds')
    .isArray({ min: 1, max: 100 })
    .withMessage('Must have 1-100 members')
    .custom((ids: string[]) => {
      return ids.every(id => typeof id === 'string' && id.length > 0);
    })
    .withMessage('Invalid member IDs'),
];

// Validation for message sending
export const validateMessageSend: ValidationChain[] = [
  body('content')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Message must be 2000 characters or less')
    .customSanitizer(sanitizeHtml),
  body('replyToId')
    .optional()
    .isString()
    .withMessage('Invalid reply ID'),
  body('attachments')
    .optional()
    .isArray({ max: 5 })
    .withMessage('Maximum 5 attachments per message'),
];

// Validation for authentication
export const validateLogin: ValidationChain[] = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address')
    .customSanitizer(sanitizeHtml),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters'),
];

// Validation for registration
export const validateRegister: ValidationChain[] = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address')
    .customSanitizer(sanitizeHtml),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be 1-50 characters')
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage('First name contains invalid characters')
    .customSanitizer(sanitizeHtml),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be 1-50 characters')
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage('Last name contains invalid characters')
    .customSanitizer(sanitizeHtml),
];

// Validation for file upload
export const validateFileUpload = (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.file;
  const maxSize = 10 * 1024 * 1024; // 10MB

  // Check file size
  if (file.size > maxSize) {
    return res.status(400).json({
      error: 'File too large',
      message: 'File size must be less than 10MB',
    });
  }

  // Check file type
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/quicktime',
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'File type not supported',
    });
  }

  // Sanitize filename
  const sanitizedFilename = file.originalname
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
  
  req.file.originalname = sanitizedFilename;

  next();
};

// Validation for patient updates
export const validatePatientUpdate: ValidationChain[] = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z\s\-']+$/)
    .customSanitizer(sanitizeHtml),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z\s\-']+$/)
    .customSanitizer(sanitizeHtml),
  body('phone')
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/)
    .withMessage('Invalid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
];

// ID parameter validation
export const validateId: ValidationChain[] = [
  param('id')
    .trim()
    .isString()
    .notEmpty()
    .withMessage('Invalid ID parameter'),
];

// Query parameter validation for pagination
export const validatePagination: ValidationChain[] = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Page must be between 1 and 10000'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

// Middleware to check validation results
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    console.warn('Validation errors:', errors.array());
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  
  next();
};

// SQL injection prevention
export const preventSqlInjection = (value: string): string => {
  // Remove SQL keywords and special characters
  return value
    .replace(/['";\\]/g, '')
    .replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|OR|AND)\b/gi, '');
};

// XSS prevention for rich text
export const sanitizeRichText = (html: string): string => {
  return purify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u'],
    ALLOWED_ATTR: [],
  });
};

export default {
  validateGroupCreate,
  validateMessageSend,
  validateLogin,
  validateRegister,
  validateFileUpload,
  validatePatientUpdate,
  validateId,
  validatePagination,
  handleValidationErrors,
  sanitizeHtml,
  preventSqlInjection,
  sanitizeRichText,
};
