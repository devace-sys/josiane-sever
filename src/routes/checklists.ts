import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess, checkCanEdit } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';
import { sendNotification, NotificationType } from '../utils/notificationHelper';

const router = express.Router();
const prisma = new PrismaClient();

// Get checklists with query params (supports patientId=me and active filter)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let patientId: string | undefined = req.query.patientId as string | undefined;
    const active = req.query.active === 'true';

    // Handle patientId=me alias
    if (patientId === 'me') {
      if (req.user.userType === 'PATIENT') {
        patientId = req.user.id;
      } else {
        return res.status(403).json({ error: 'Only patients can use patientId=me' });
      }
    }

    // For patients, they can only see their own checklists
    if (req.user.userType === 'PATIENT') {
      if (!patientId) {
        patientId = req.user.id;
      } else if (patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (patientId) {
      // For operators, check access if patientId is specified
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
          return res.status(403).json({ error: 'No access to this patient' });
        }
      }
    }

    const where: any = {};
    if (patientId) {
      where.patientId = patientId;
    }
    if (active) {
      // Active means not completed and (no dueDate or dueDate in future)
      where.completed = false;
      where.OR = [
        { dueDate: null },
        { dueDate: { gte: new Date() } },
      ];
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await prisma.checklist.count({ where });

    const checklists = await prisma.checklist.findMany({
      where,
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    res.json({ 
      data: checklists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get checklists error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch checklists: ${errorMessage}` });
  }
});

// Get checklist summary (pending items count)
router.get('/summary', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let patientId: string | undefined = req.query.patientId as string | undefined;

    // Handle patientId=me alias
    if (patientId === 'me') {
      if (req.user.userType === 'PATIENT') {
        patientId = req.user.id;
      } else {
        return res.status(403).json({ error: 'Only patients can use patientId=me' });
      }
    }

    // For patients, they can only see their own summary
    if (req.user.userType === 'PATIENT') {
      if (!patientId) {
        patientId = req.user.id;
      } else if (patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (patientId) {
      // For operators, check access if patientId is specified
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
          return res.status(403).json({ error: 'No access to this patient' });
        }
      }
    }

    if (!patientId) {
      return res.status(400).json({ error: 'patientId is required' });
    }

    const checklists = await prisma.checklist.findMany({
      where: {
        patientId,
        completed: false,
        OR: [
          { dueDate: null },
          { dueDate: { gte: new Date() } },
        ],
      },
    });

    // Calculate pending items count
    let pendingItemsCount = 0;
    checklists.forEach(checklist => {
      if (Array.isArray(checklist.items)) {
        const pendingItems = checklist.items.filter((item: any) => !item.completed);
        pendingItemsCount += pendingItems.length;
      }
    });

    // Log audit for checklist summary viewing
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.VIEW,
        resourceType: 'ChecklistSummary',
        resourceId: patientId,
        details: { activeChecklists: checklists.length, pendingItemsCount },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    res.json({
      activeChecklists: checklists.length,
      pendingItemsCount,
    });
  } catch (error) {
    console.error('Get checklist summary error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch checklist summary: ${errorMessage}` });
  }
});

// Get checklists for patient (backward compatibility)
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const active = req.query.active === 'true';

    const where: any = { patientId };
    if (active) {
      where.completed = false;
      where.OR = [
        { dueDate: null },
        { dueDate: { gte: new Date() } },
      ];
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await prisma.checklist.count({ where });

    const checklists = await prisma.checklist.findMany({
      where,
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    res.json({ 
      data: checklists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get checklists error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch checklists: ${errorMessage}` });
  }
});

// Get checklist by ID
router.get('/:checklistId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { checklistId } = req.params;
    const checklist = await prisma.checklist.findUnique({
      where: { id: checklistId },
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!checklist) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    // Check access
    if (req.user?.userType === 'PATIENT') {
      if (checklist.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user?.role !== 'ADMIN') {
      // Check operator access
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: checklist.patientId,
            operatorId: req.user!.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canView) {
        return res.status(403).json({ error: 'No access to this patient' });
      }
    }

    res.json({ checklist });
  } catch (error) {
    console.error('Get checklist error:', error);
    res.status(500).json({ error: 'Failed to fetch checklist' });
  }
});

// Create checklist (ADMIN cannot create - only SUPPORT/operators can)
router.post(
  '/',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  checkCanEdit,
  [body('patientId').notEmpty(), body('title').notEmpty(), body('items').isArray()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { patientId, title, description, items, dueDate } = req.body;

      // Validate items array
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Checklist must have at least one item' });
      }

      // Validate item structure
      for (const item of items) {
        if (!item.text || typeof item.text !== 'string') {
          return res.status(400).json({ error: 'Each item must have a text field' });
        }
        if (typeof item.completed !== 'boolean') {
          return res.status(400).json({ error: 'Each item must have a completed boolean field' });
        }
      }

      // Validate due date is in the future if provided
      if (dueDate) {
        const dueDateObj = new Date(dueDate);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (dueDateObj < now) {
          return res.status(400).json({ error: 'Due date cannot be in the past' });
        }
      }

      const checklist = await prisma.checklist.create({
        data: {
          patientId,
          operatorId: req.user.id,
          title,
          description,
          items,
          dueDate: dueDate ? new Date(dueDate) : null,
        },
        include: {
          operator: {
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
        action: AuditAction.CREATE,
        resourceType: 'Checklist',
        resourceId: checklist.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Send notification to patient
      const operatorName = `${req.user.firstName} ${req.user.lastName}`;
      const itemCount = Array.isArray(items) ? items.length : 0;
      await sendNotification({
        userId: patientId,
        title: 'New Checklist',
        message: `${operatorName} assigned "${title}" checklist with ${itemCount} items`,
        type: NotificationType.CHECKLIST_CREATED,
        data: { checklistId: checklist.id, itemCount },
      });

      res.status(201).json({ checklist });
    } catch (error) {
      console.error('Create checklist error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ error: `Failed to create checklist: ${errorMessage}` });
    }
  }
);

// Update checklist
router.put('/:checklistId', authenticateToken, [
  body('title').optional().notEmpty(),
  body('items').optional().isArray(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { checklistId } = req.params;
    const { title, description, items, dueDate, completed } = req.body;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const checklist = await prisma.checklist.findUnique({ where: { id: checklistId } });
    if (!checklist) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    // Patients can only update their own checklists (mark items complete and completion status)
    if (req.user.userType === 'PATIENT') {
      if (checklist.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Patients can update items array (to mark individual items as complete) and completion status
      const updateData: any = {};
      
      if (items !== undefined) {
        if (!Array.isArray(items)) {
          return res.status(400).json({ error: 'items must be an array' });
        }
        // Validate item structure
        for (const item of items) {
          if (!item || typeof item !== 'object') {
            return res.status(400).json({ error: 'Each item must be an object' });
          }
          if (!item.text || typeof item.text !== 'string') {
            return res.status(400).json({ error: 'Each item must have a text field (string)' });
          }
          if (typeof item.completed !== 'boolean') {
            return res.status(400).json({ error: 'Each item must have a completed field (boolean)' });
          }
        }
        updateData.items = items;
      }
      
      if (completed !== undefined) {
        updateData.completed = completed;
        updateData.completedAt = completed && !checklist.completed ? new Date() : (completed ? checklist.completedAt : null);
        
        // Send notification to operator when checklist is completed
        if (completed && !checklist.completed) {
          const patientName = `${req.user.firstName} ${req.user.lastName}`;
          await sendNotification({
            userId: checklist.operatorId,
            title: 'Checklist Completed',
            message: `${patientName} completed "${checklist.title}" checklist`,
            type: NotificationType.CHECKLIST_COMPLETED,
            data: { checklistId, patientId: req.user.id },
          });
        }
      }

      const updatedChecklist = await prisma.checklist.update({
        where: { id: checklistId },
        data: updateData,
      });
      return res.json({ checklist: updatedChecklist });
    }

    // Operators need canEdit permission
    if (req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: checklist.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canEdit) {
        return res.status(403).json({ error: 'Edit permission required' });
      }
    }

    const updateData: any = {
      title,
      description,
      completed,
      completedAt: completed && !checklist.completed ? new Date() : checklist.completedAt,
    };

    if (items !== undefined) {
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items must be an array' });
      }
      updateData.items = items;
    }

    if (dueDate !== undefined && dueDate !== null) {
      updateData.dueDate = new Date(dueDate);
    } else if (dueDate === null) {
      updateData.dueDate = null;
    }

    const updatedChecklist = await prisma.checklist.update({
      where: { id: checklistId },
      data: updateData,
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.UPDATE,
      resourceType: 'Checklist',
      resourceId: checklistId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ checklist: updatedChecklist });
  } catch (error) {
    console.error('Update checklist error:', error);
    res.status(500).json({ error: 'Failed to update checklist' });
  }
});

// Delete checklist (admin only)
router.delete('/:checklistId', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { checklistId } = req.params;
    await prisma.checklist.delete({ where: { id: checklistId } });
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'Checklist',
      resourceId: checklistId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Checklist deleted' });
  } catch (error) {
    console.error('Delete checklist error:', error);
    res.status(500).json({ error: 'Failed to delete checklist' });
  }
});

export default router;


