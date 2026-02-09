import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate limiting middleware for production security
 * Prevents abuse and DDoS attacks
 */

// Extend Express Request with rateLimit (user is defined in src/types/express.d.ts)
declare module 'express-serve-static-core' {
  interface Request {
    rateLimit?: {
      limit: number;
      current: number;
      remaining: number;
      resetTime: Date;
    };
  }
}

// General API rate limiter - 100 requests per 15 minutes
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 900,
    });
  },
});

// Strict rate limiter for auth endpoints - 5 attempts per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  handler: (req: Request, res: Response) => {
    console.error(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Account temporarily locked. Please try again in 15 minutes.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 900,
    });
  },
});

// Message sending rate limiter - 30 messages per minute
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: 'Too many messages sent, please slow down.',
  handler: (req: Request, res: Response) => {
    const userId = req.user?.id || 'unknown';
    console.warn(`Message rate limit exceeded for user: ${userId}`);
    res.status(429).json({
      error: 'Too many messages',
      message: 'You are sending messages too quickly. Please wait a moment.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 60,
    });
  },
});

// File upload rate limiter - 10 uploads per hour
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many file uploads, please try again later.',
  handler: (req: Request, res: Response) => {
    const userId = req.user?.id || 'unknown';
    console.warn(`Upload rate limit exceeded for user: ${userId}`);
    res.status(429).json({
      error: 'Too many uploads',
      message: 'You have reached the upload limit. Please try again later.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 3600,
    });
  },
});

// Create account rate limiter - 3 accounts per hour per IP
export const createAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many accounts created from this IP.',
  handler: (req: Request, res: Response) => {
    console.error(`Account creation rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many account creation attempts',
      message: 'Too many accounts created from this IP address.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 3600,
    });
  },
});

// Password reset rate limiter - 3 attempts per hour
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many password reset attempts.',
  handler: (req: Request, res: Response) => {
    console.warn(`Password reset rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many password reset attempts',
      message: 'Please wait before requesting another password reset.',
      retryAfter: req.rateLimit?.resetTime ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000) : 3600,
    });
  },
});

export default {
  apiLimiter,
  authLimiter,
  messageLimiter,
  uploadLimiter,
  createAccountLimiter,
  passwordResetLimiter,
};
