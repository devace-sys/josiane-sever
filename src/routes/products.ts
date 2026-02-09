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

// Get all products
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    res.json({ products });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get products for patient
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const patientProducts = await prisma.patientProduct.findMany({
      where: { patientId },
      include: {
        product: true,
      },
      orderBy: { assignedAt: 'desc' },
    });

    res.json({ products: patientProducts });
  } catch (error) {
    console.error('Get patient products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get product by ID
router.get('/:productId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create product (admin only)
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  [body('name').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, instructions, benefits, image, category } = req.body;

      const product = await prisma.product.create({
        data: {
          name,
          description,
          instructions,
          benefits,
          image,
          category,
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'Product',
          resourceId: product.id,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.status(201).json({ product });
    } catch (error) {
      console.error('Create product error:', error);
      res.status(500).json({ error: 'Failed to create product' });
    }
  }
);

// Assign product to patient (ADMIN cannot assign - only SUPPORT/operators can)
router.post(
  '/:productId/assign',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  checkCanEdit,
  [body('patientId').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { productId } = req.params;
      const { patientId } = req.body;

      const patientProduct = await prisma.patientProduct.upsert({
        where: {
          patientId_productId: {
            patientId,
            productId,
          },
        },
        update: {},
        create: {
          patientId,
          productId,
          assignedAt: new Date(),
        },
        include: {
          product: true,
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.CREATE,
        resourceType: 'PatientProduct',
        resourceId: patientProduct.id,
        details: { patientId, productId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Send notification to patient
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true },
      });

      if (product && product.name) {
        const operatorName = `${req.user.firstName} ${req.user.lastName}`;
        await sendNotification({
          userId: patientId,
          title: 'New Product Assigned',
          message: `${operatorName} assigned "${product.name}" to you`,
          type: NotificationType.PRODUCT_ASSIGNED,
          data: { productId, assignmentId: patientProduct.id },
        });
      }

      res.json({ patientProduct });
    } catch (error) {
      console.error('Assign product error:', error);
      res.status(500).json({ error: 'Failed to assign product' });
    }
  }
);

// Update patient product usage
router.put('/patient/:patientId/product/:productId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId, productId } = req.params;
    const { usageCount, lastUsedAt, notes } = req.body;

    // Validate request body fields
    if (usageCount !== undefined && (typeof usageCount !== 'number' || usageCount < 0)) {
      return res.status(400).json({ error: 'usageCount must be a non-negative number' });
    }
    if (lastUsedAt !== undefined && lastUsedAt !== null && isNaN(Date.parse(lastUsedAt))) {
      return res.status(400).json({ error: 'lastUsedAt must be a valid date string' });
    }
    if (notes !== undefined && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string' });
    }

    const patientProduct = await prisma.patientProduct.update({
      where: {
        patientId_productId: {
          patientId,
          productId,
        },
      },
      data: {
        usageCount,
        lastUsedAt: lastUsedAt ? new Date(lastUsedAt) : undefined,
        notes,
        usageStartedAt: req.body.usageStartedAt ? new Date(req.body.usageStartedAt) : undefined,
      },
      include: {
        product: true,
      },
    });

    res.json({ patientProduct });
  } catch (error) {
    console.error('Update patient product error:', error);
    res.status(500).json({ error: 'Failed to update product usage' });
  }
});

// Update product (admin only)
router.put(
  '/:productId',
  authenticateToken,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { productId } = req.params;
      const { name, description, instructions, benefits, image, category, isActive } = req.body;

      const product = await prisma.product.update({
        where: { id: productId },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(instructions !== undefined && { instructions }),
          ...(benefits !== undefined && { benefits }),
          ...(image !== undefined && { image }),
          ...(category !== undefined && { category }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.UPDATE,
        resourceType: 'Product',
        resourceId: productId,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ product });
    } catch (error) {
      console.error('Update product error:', error);
      res.status(500).json({ error: 'Failed to update product' });
    }
  }
);

// Delete product (admin only - soft delete)
router.delete(
  '/:productId',
  authenticateToken,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { productId } = req.params;

      // Soft delete by setting isActive to false
      const product = await prisma.product.update({
        where: { id: productId },
        data: { isActive: false },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.DELETE,
        resourceType: 'Product',
        resourceId: productId,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ message: 'Product deleted', product });
    } catch (error) {
      console.error('Delete product error:', error);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  }
);

// Delete patient product assignment (ADMIN cannot delete - only SUPPORT/BASIC operators can)
router.delete('/patient/:patientId/product/:productId', authenticateToken, requireRole('SUPPORT', 'BASIC'), checkCanEdit, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { patientId, productId } = req.params;
    await prisma.patientProduct.delete({
      where: {
        patientId_productId: {
          patientId,
          productId,
        },
      },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'PatientProduct',
      details: { patientId, productId },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Product assignment deleted' });
  } catch (error) {
    console.error('Delete patient product error:', error);
    res.status(500).json({ error: 'Failed to delete product assignment' });
  }
});

export default router;

