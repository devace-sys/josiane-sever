import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess, checkCanEdit } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';

const router = express.Router();
const prisma = new PrismaClient();

// Get before/after photos for patient
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const beforeAfter = await prisma.beforeAfter.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ beforeAfter });
  } catch (error) {
    console.error('Get before/after error:', error);
    res.status(500).json({ error: 'Failed to fetch before/after photos' });
  }
});

// Get before/after by ID
router.get('/:beforeAfterId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { beforeAfterId } = req.params;
    const beforeAfter = await prisma.beforeAfter.findUnique({
      where: { id: beforeAfterId },
    });

    if (!beforeAfter) {
      return res.status(404).json({ error: 'Before/After not found' });
    }

    // Check access
    if (req.user.userType === 'PATIENT') {
      if (beforeAfter.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (!req.user.role || req.user.role !== 'ADMIN') {
      // Check operator access
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: beforeAfter.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canView) {
        return res.status(403).json({ error: 'No access to this patient' });
      }
    }

    res.json({ beforeAfter });
  } catch (error) {
    console.error('Get before/after error:', error);
    res.status(500).json({ error: 'Failed to fetch before/after' });
  }
});

// Create before/after (ADMIN cannot create - only SUPPORT/operators can)
router.post(
  '/',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  checkCanEdit,
  [body('patientId').notEmpty(), body('beforeImage').notEmpty(), body('afterImage').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { patientId, beforeImage, afterImage, notes } = req.body;

      const beforeAfter = await prisma.beforeAfter.create({
        data: {
          patientId,
          beforeImage,
          afterImage,
          notes,
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'BeforeAfter',
          resourceId: beforeAfter.id,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.status(201).json({ beforeAfter });
    } catch (error) {
      console.error('Create before/after error:', error);
      res.status(500).json({ error: 'Failed to create before/after' });
    }
  }
);

// Update before/after (ADMIN cannot update - only SUPPORT/BASIC operators can)
router.put('/:beforeAfterId', authenticateToken, requireRole('SUPPORT', 'BASIC'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { beforeAfterId } = req.params;
    const { beforeImage, afterImage, notes } = req.body;

    // Get beforeAfter to check patient access
    const existing = await prisma.beforeAfter.findUnique({
      where: { id: beforeAfterId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Before/After not found' });
    }

    // Check canEdit permission
    const hasAccess = await prisma.patientAccess.findUnique({
      where: {
        patientId_operatorId: {
          patientId: existing.patientId,
          operatorId: req.user.id,
        },
      },
    });

    if (!hasAccess || !hasAccess.canEdit) {
      return res.status(403).json({ error: 'Edit permission required' });
    }

    const beforeAfter = await prisma.beforeAfter.update({
      where: { id: beforeAfterId },
      data: {
        beforeImage,
        afterImage,
        notes,
      },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.UPDATE,
      resourceType: 'BeforeAfter',
      resourceId: beforeAfterId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ beforeAfter });
  } catch (error) {
    console.error('Update before/after error:', error);
    res.status(500).json({ error: 'Failed to update before/after' });
  }
});

// Delete before/after (admin only)
router.delete('/:beforeAfterId', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { beforeAfterId } = req.params;
    await prisma.beforeAfter.delete({ where: { id: beforeAfterId } });
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'BeforeAfter',
      resourceId: beforeAfterId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Before/After deleted' });
  } catch (error) {
    console.error('Delete before/after error:', error);
    res.status(500).json({ error: 'Failed to delete before/after' });
  }
});

export default router;


