import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    userType: 'PATIENT' | 'OPERATOR';
    role?: string;
    firstName?: string;
    lastName?: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    
    // ALL users (patients and operators) are in the User table
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userType: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // CRITICAL FIX: Update lastLoginAt on every authenticated request to track activity
    // This is essential for the "active user" status calculation
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch((error) => {
      // Don't fail the request if lastLoginAt update fails, just log it
      console.error('Failed to update lastLoginAt:', error);
    });

    req.user = {
      id: user.id,
      email: user.email,
      userType: user.userType as 'PATIENT' | 'OPERATOR',
      role: user.role || undefined,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.userType === 'PATIENT') {
      return res.status(403).json({ error: 'Operator access required' });
    }

    if (!roles.includes(req.user.role || '')) {
      return res.status(403).json({ 
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}` 
      });
    }

    next();
  };
};

// CRITICAL FIX: Middleware to block ADMIN from certain operations
// ADMIN can VIEW all data but cannot CREATE/EDIT medical records
export const blockAdminEdits = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role === 'ADMIN') {
    return res.status(403).json({ 
      error: 'Administrators can view all data but cannot create or edit medical records. Only assigned doctors can perform these operations.' 
    });
  }

  next();
};

