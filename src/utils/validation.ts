/**
 * Centralized validation utilities
 */

// Password validation - minimum 8 characters, requires uppercase, lowercase, and number
export const passwordValidation = {
  minLength: 8,
  regex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
  message: 'Password must be at least 8 characters and contain uppercase, lowercase, and number',
};

// Email validation
export const emailValidation = {
  regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  message: 'Invalid email format',
};

// Phone validation (flexible international format)
export const phoneValidation = {
  regex: /^[\d\s\-\+\(\)]{10,}$/,
  message: 'Invalid phone number format',
};

// Date validation helpers
export const isValidDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};

export const isNotFutureDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return date <= new Date();
};

export const isFutureDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return date > new Date();
};

// URL validation
export const urlValidation = {
  regex: /^https?:\/\/.+$/,
  message: 'Invalid URL format (must start with http:// or https://)',
};

// Hex color validation
export const hexColorValidation = {
  regex: /^#[0-9A-Fa-f]{6}$/,
  message: 'Invalid hex color format (must be #RRGGBB)',
};
