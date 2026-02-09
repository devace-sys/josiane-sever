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

// Get all showcases (approved only for public)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if community feature is enabled
    const config = await (prisma as any).clinicConfig.findFirst();
    if (config && !config.featureCommunityEnabled) {
      return res.status(403).json({ error: 'Community feature is disabled' });
    }

    const { treatmentType, status } = req.query;
    
    const where: any = {};
    if (treatmentType) {
      where.treatmentType = treatmentType;
    }
    if (status) {
      where.status = status;
    } else if (!req.user || req.user.role !== 'ADMIN') {
      // Only show approved showcases to non-admins
      where.status = 'APPROVED';
    }

    const showcases = await prisma.showcase.findMany({
      where,
      include: {
        // Showcase.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        approver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ showcases });
  } catch (error) {
    console.error('Get showcases error:', error);
    res.status(500).json({ error: 'Failed to fetch showcases' });
  }
});

// Get showcases for patient
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const showcase = await prisma.showcase.findUnique({
      where: { patientId },
      include: {
        // Showcase.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
      },
    });

    res.json({ showcase });
  } catch (error) {
    console.error('Get patient showcase error:', error);
    res.status(500).json({ error: 'Failed to fetch showcase' });
  }
});

// Get showcase by ID
router.get('/:showcaseId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { showcaseId } = req.params;
    const showcase = await prisma.showcase.findUnique({
      where: { id: showcaseId },
      include: {
        // Showcase.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        approver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!showcase) {
      return res.status(404).json({ error: 'Showcase not found' });
    }

    // Check access - patients can only see their own, operators need access, admins can see all
    if (req.user.userType === 'PATIENT') {
      if (showcase.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.role !== 'ADMIN') {
      // Check operator access
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: showcase.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canView) {
        return res.status(403).json({ error: 'No access to this patient' });
      }
    }

    res.json({ showcase });
  } catch (error) {
    console.error('Get showcase error:', error);
    res.status(500).json({ error: 'Failed to fetch showcase' });
  }
});

// Create showcase (patients: own only; operators: SUPPORT/BASIC with edit access)
router.post(
  '/',
  authenticateToken,
  checkCanEdit,
  [
    body('patientId').notEmpty(),
    body('beforeImage').notEmpty(),
    body('afterImage').notEmpty(),
    body('title').notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { patientId, beforeImage, afterImage, title, description, testimonial, treatmentType, timePeriod } = req.body;

      // Patients may only create a showcase for themselves
      if (req.user?.userType === 'PATIENT' && patientId !== req.user.id) {
        return res.status(403).json({ error: 'You can only submit a showcase for your own account' });
      }
      // Operators must have SUPPORT or BASIC role (ADMIN cannot create)
      if (req.user?.userType === 'OPERATOR') {
        if (req.user.role === 'ADMIN') {
          return res.status(403).json({ error: 'Administrators cannot create showcases. Use the admin panel to manage submissions.' });
        }
        if (req.user.role !== 'SUPPORT' && req.user.role !== 'BASIC') {
          return res.status(403).json({ error: 'Operator access required' });
        }
      }

      const showcase = await prisma.showcase.upsert({
        where: { patientId },
        update: {
          beforeImage,
          afterImage,
          title,
          description,
          testimonial,
          treatmentType,
          timePeriod,
          status: 'PENDING',
        },
        create: {
          patientId,
          beforeImage,
          afterImage,
          title,
          description,
          testimonial,
          treatmentType,
          timePeriod,
          status: 'PENDING',
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profileImage: true,
            },
          },
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'Showcase',
          resourceId: showcase.id,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.status(201).json({ showcase });
    } catch (error) {
      console.error('Create showcase error:', error);
      res.status(500).json({ error: 'Failed to create showcase' });
    }
  }
);

// Update showcase
router.put(
  '/:showcaseId',
  authenticateToken,
  [
    body('beforeImage').notEmpty().withMessage('Before image is required'),
    body('afterImage').notEmpty().withMessage('After image is required'),
    body('title').notEmpty().withMessage('Title is required'),
    body('treatmentType').optional().isIn(['AESTHETIC', 'NUTRITION', 'WELLNESS', 'COMBINED']).withMessage('Invalid treatment type'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { showcaseId } = req.params;
      const { beforeImage, afterImage, title, description, testimonial, treatmentType, timePeriod, patientId } = req.body;

      // Check if showcase exists
      const existingShowcase = await prisma.showcase.findUnique({
        where: { id: showcaseId },
      });

      if (!existingShowcase) {
        return res.status(404).json({ error: 'Showcase not found' });
      }

      // Check permissions
      // Admins can update any showcase
      // SUPPORT/BASIC can only update showcases for patients they have edit access to
      if (req.user?.role !== 'ADMIN') {
        if (!req.user?.role || !['SUPPORT', 'BASIC'].includes(req.user.role)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }

        // Check if user has edit access to the patient
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: existingShowcase.patientId || '',
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canEdit) {
          return res.status(403).json({ error: 'No edit access to this patient' });
        }
      }

      // If patientId is being changed, check access to new patient (for admins)
      if (patientId && patientId !== existingShowcase.patientId) {
        if (req.user.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Cannot change patient ID' });
        }
        // For admins, verify the new patient exists
        const newPatient = await prisma.user.findUnique({
          where: { id: patientId },
        });
        if (!newPatient) {
          return res.status(404).json({ error: 'New patient not found' });
        }
      }

      // Update showcase
      const showcase = await prisma.showcase.update({
        where: { id: showcaseId },
        data: {
          beforeImage,
          afterImage,
          title,
          description: description || null,
          testimonial: testimonial || null,
          treatmentType: treatmentType || null,
          timePeriod: timePeriod || null,
          ...(patientId && patientId !== existingShowcase.patientId ? { patientId } : {}),
          // Reset status to PENDING if content changed (except for admins who might want to keep status)
          ...(req.user.role !== 'ADMIN' ? { status: 'PENDING' } : {}),
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profileImage: true,
            },
          },
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.UPDATE,
        resourceType: 'Showcase',
        resourceId: showcaseId,
        details: { 
          updatedFields: {
            beforeImage,
            afterImage,
            title,
            description,
            testimonial,
            treatmentType,
            timePeriod,
            ...(patientId && patientId !== existingShowcase.patientId ? { patientId } : {}),
          },
        },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ showcase });
    } catch (error) {
      console.error('Update showcase error:', error);
      res.status(500).json({ error: 'Failed to update showcase' });
    }
  }
);

// Approve showcase (admin only)
router.post('/:showcaseId/approve', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { showcaseId } = req.params;
      const showcase = await prisma.showcase.update({
        where: { id: showcaseId },
        data: {
          status: 'APPROVED',
          approvedBy: req.user.id,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.UPDATE,
        resourceType: 'Showcase',
        resourceId: showcaseId,
        details: { action: 'APPROVED' },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ showcase });
  } catch (error) {
    console.error('Approve showcase error:', error);
    res.status(500).json({ error: 'Failed to approve showcase' });
  }
});

// Reject showcase (admin only)
router.post(
  '/:showcaseId/reject',
  authenticateToken,
  requireRole('ADMIN'),
  [body('rejectionReason').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { showcaseId } = req.params;
      const { rejectionReason } = req.body;

      const showcase = await prisma.showcase.update({
        where: { id: showcaseId },
        data: {
          status: 'REJECTED',
          rejectionReason,
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.UPDATE,
          resourceType: 'Showcase',
          resourceId: showcaseId,
          details: { action: 'REJECTED' },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.json({ showcase });
    } catch (error) {
      console.error('Reject showcase error:', error);
      res.status(500).json({ error: 'Failed to reject showcase' });
    }
  }
);

// Delete showcase (admin only)
router.delete('/:showcaseId', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { showcaseId } = req.params;
    await prisma.showcase.delete({ where: { id: showcaseId } });
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'Showcase',
      resourceId: showcaseId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Showcase deleted' });
  } catch (error) {
    console.error('Delete showcase error:', error);
    res.status(500).json({ error: 'Failed to delete showcase' });
  }
});

export default router;


