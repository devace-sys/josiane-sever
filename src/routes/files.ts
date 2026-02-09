import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';
import { safeResolveFilePath } from '../utils/fileUtils';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Uploads are rendered directly by <Image> / <img>, which cannot send custom headers reliably.
 * SECURITY WARNING: Query string tokens are logged in server logs and browser history.
 * Prefer Authorization header when possible. Query string support is deprecated.
 * Support BOTH:
 * - Authorization: Bearer <token> (RECOMMENDED)
 * - /uploads/... ?token=<token> (DEPRECATED - will be removed in future version)
 */
const authenticateUploadsRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
    
    // SECURITY: Warn if token is in query string (logged in server logs)
    if (tokenFromQuery && !tokenFromHeader) {
      console.warn('[SECURITY] Token passed in query string - this is logged in server logs. Use Authorization header instead.');
    }
    
    const token = tokenFromHeader || tokenFromQuery;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, secret) as any;

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

    req.user = {
      id: user.id,
      email: user.email,
      userType: user.userType as 'PATIENT' | 'OPERATOR',
      role: user.role || undefined,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
    };

    next();
  } catch (error) {
    console.error('[FILES] Auth error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Handle preflight OPTIONS requests
router.options('/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Serve files with access control
router.get('/*', authenticateUploadsRequest, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const filePath = req.params[0];
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    
    // Resolve with path traversal protection
    const resolvedPath = safeResolveFilePath(uploadsDir, filePath);
    
    if (!resolvedPath) {
      console.error('[FILES] Path traversal attempt:', filePath);
      return res.status(403).json({ error: 'Invalid file path' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Determine file type from path and enforce access control
    if (filePath.startsWith('profile-images/')) {
      // Profile images are accessible to authenticated users
      // Set CORS headers to allow browser to display the image
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }
    
    if (filePath.startsWith('session-files/')) {
      // Session files - check session access
      // CRITICAL FIX: Search by filePath (server filename) NOT fileName (original filename)
      const fullPath = `/uploads/${filePath}`;
      const sessionFile = await prisma.sessionFile.findFirst({
        where: {
          filePath: fullPath,
        },
        include: {
          session: true,
        },
      });

      if (!sessionFile) {
        return res.status(404).json({ error: 'File not found in database' });
      }

      // Check if session relation exists
      if (!sessionFile.session) {
        return res.status(500).json({ error: 'Session data is missing for this file' });
      }

      // Check access
      if (req.user.userType === 'PATIENT') {
        if (!sessionFile.session.patientId || sessionFile.session.patientId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }
        // Check visibility
        if (sessionFile.visibility === 'OPERATOR_ONLY') {
          return res.status(403).json({ error: 'This file is only visible to operators' });
        }
      } else if (req.user.userType === 'OPERATOR') {
        if (req.user.role !== 'ADMIN') {
          if (!sessionFile.session.patientId) {
            return res.status(500).json({ error: 'Session patient ID is missing' });
          }
          const hasAccess = await prisma.patientAccess.findUnique({
            where: {
              patientId_operatorId: {
                patientId: sessionFile.session.patientId,
                operatorId: req.user.id,
              },
            },
          });

          if (!hasAccess || !hasAccess.canView) {
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      }

      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }

    if (filePath.startsWith('message-attachments/')) {
      // Message attachments - check patient room access
      // CRITICAL FIX: Search by filePath (which contains the server filename like /uploads/message-attachments/message-123.jpg)
      // NOT by fileName (which contains the original filename like photo.jpg)
      const fullPath = `/uploads/${filePath}`;
      const attachment = await prisma.messageAttachment.findFirst({
        where: {
          filePath: fullPath,
        },
        include: {
          message: true,
        },
      });

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Check if message relation exists
      if (!attachment.message) {
        return res.status(500).json({ error: 'Message data is missing for this attachment' });
      }

      const msg = attachment.message;
      const patientId = msg.patientId;
      const groupId = msg.groupId;

      if (groupId) {
        // Group message attachment: check group membership
        const membership = await prisma.groupMember.findFirst({
          where: {
            groupId,
            userId: req.user.id,
            leftAt: null,
          },
        });
        if (!membership) {
          return res.status(403).json({ error: 'Access denied to this group' });
        }
      } else if (patientId) {
        // 1:1 message attachment: check patient room access
        if (req.user.userType === 'PATIENT') {
          if (patientId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
          }
        } else if (req.user.userType === 'OPERATOR') {
          if (req.user.role !== 'ADMIN') {
            const hasAccess = await prisma.patientAccess.findUnique({
              where: {
                patientId_operatorId: {
                  patientId,
                  operatorId: req.user.id,
                },
              },
            });
            if (!hasAccess || !hasAccess.canView) {
              return res.status(403).json({ error: 'Access denied' });
            }
          }
        }
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }

    if (filePath.startsWith('patient-uploads/')) {
      // Patient uploads - check access
      // CRITICAL FIX: Search by filePath (server filename) NOT fileName (original filename)
      const fullPath = `/uploads/${filePath}`;
      const upload = await prisma.patientUpload.findFirst({
        where: {
          filePath: fullPath,
        },
      });

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      // Check access
      if (req.user.userType === 'PATIENT') {
        if (upload.patientId !== req.user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else if (req.user.userType === 'OPERATOR') {
        if (req.user.role !== 'ADMIN') {
          const hasAccess = await prisma.patientAccess.findUnique({
            where: {
              patientId_operatorId: {
                patientId: upload.patientId,
                operatorId: req.user.id,
              },
            },
          });

          if (!hasAccess || !hasAccess.canView) {
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      }

      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }

    if (filePath.startsWith('content-files/')) {
      // Content files - check content assignment or public status
      // For simplicity, allow access to authenticated users (content endpoints handle access)
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }

    if (filePath.startsWith('showcase-images/')) {
      // Showcase images - allow access to authenticated users
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.sendFile(resolvedPath);
    }

    // Default: deny access to other paths
    return res.status(403).json({ error: 'Access denied to this file type' });
  } catch (error) {
    console.error('[FILES] Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;
