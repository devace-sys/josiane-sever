import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction is an enum that will be available after Prisma client regeneration
import { AuditAction } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Get audit logs (admin only)
router.get('/', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, action, resourceType, startDate, endDate, limit = 100, offset = 0 } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);
    
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Invalid offset parameter' });
    }

    const where: any = {};
    if (userId) {
      where.userId = userId as string;
    }
    if (action) {
      where.action = action as AuditAction;
    }
    if (resourceType) {
      where.resourceType = resourceType as string;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Get chat logs (admin only, read-only)
router.get('/chat', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { patientId, startDate, endDate, limit = 100, offset = 0 } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);
    
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Invalid offset parameter' });
    }

    const where: any = {};
    if (patientId) {
      where.patientId = patientId as string;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
          // Message.patient references User directly (not Patient)
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              patientProfile: true, // Include relation in select (not include)
            },
          },
          attachments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.message.count({ where }),
    ]);

    res.json({ messages, total });
  } catch (error) {
    console.error('Get chat logs error:', error);
    res.status(500).json({ error: 'Failed to fetch chat logs' });
  }
});

// Get patient audit logs (patient can see their own logs)
router.get('/patient/:patientId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { patientId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);
    
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Invalid offset parameter' });
    }

    // Patients can only see their own logs
    if (req.user.userType === 'PATIENT' && req.user.id !== patientId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Operators can see logs for patients they have access to
    if (req.user.userType === 'OPERATOR') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId,
            operatorId: req.user.id,
          },
        },
      });

      // Admin can see all
      if (req.user.role !== 'ADMIN' && !hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        userId: patientId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: parsedLimit,
      skip: parsedOffset,
    });

    res.json({ logs });
  } catch (error) {
    console.error('Get patient audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Get access history (admin only)
router.get('/access', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { patientId, operatorId, startDate, endDate, limit = 100, offset = 0 } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);
    
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return res.status(400).json({ error: 'Invalid limit parameter' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Invalid offset parameter' });
    }

    const where: any = {
      action: 'ACCESS_GRANTED',
    };
    if (patientId) {
      where.resourceId = patientId as string;
      where.resourceType = 'Patient';
    }
    if (operatorId) {
      where.userId = operatorId as string;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total });
  } catch (error) {
    console.error('Get access history error:', error);
    res.status(500).json({ error: 'Failed to fetch access history' });
  }
});

export default router;

