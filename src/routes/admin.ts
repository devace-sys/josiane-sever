import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { auditLogger } from '../utils/auditLogger';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { passwordValidation } from '../utils/validation';
import { patientRepository } from '../repositories';
import { flattenPatientArray } from '../utils/patientHelpers';

const router = express.Router();
const prisma = new PrismaClient();

// All admin routes require ADMIN role
router.use(authenticateToken);
router.use(requireRole('ADMIN'));

// Get patients assigned to a specific operator (for Doctor details / Edit Doctor)
router.get('/operators/:operatorId/assigned-patients', async (req: AuthRequest, res: Response) => {
  try {
    const { operatorId } = req.params;
    const patients = await patientRepository.findAll(operatorId);
    const flattened = flattenPatientArray(patients);
    res.json({ patients: flattened });
  } catch (error) {
    console.error('Get assigned patients error:', error);
    res.status(500).json({ error: 'Failed to fetch assigned patients' });
  }
});

// Get all users
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        profileImage: true,
        userType: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        patientAccesses: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate active status based on lastLoginAt
    // CRITICAL FIX: Users who've never logged in should show as "Pending" or "Inactive", not "Active"
    const usersWithStatus = users.map((user: any) => {
      const lastLoginAt = user.lastLoginAt ? new Date(user.lastLoginAt) : null;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // If never logged in (lastLoginAt is null), consider inactive
      // If logged in, check if it was within last 30 days
      const isActuallyActive = lastLoginAt ? (lastLoginAt >= thirtyDaysAgo && user.isActive) : false;
      
      return { 
        ...user, 
        isActive: isActuallyActive,
        accesses: user.patientAccesses || [],
      };
    });

    res.json({ users: usersWithStatus });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all patients
router.get('/patients', async (req: AuthRequest, res: Response) => {
  try {
    const patients = await prisma.patient.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            patientAccessesAsPatient: {
              include: {
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Flatten patient data: merge user fields into patient object for frontend compatibility
    const flattenedPatients = patients.map((patient: any) => {
      const { user, ...patientData } = patient;
      const lastLoginAt = user?.lastLoginAt ? new Date(user.lastLoginAt) : null;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      // CRITICAL FIX: Patients who've never logged in show as inactive, not active
      const isActuallyActive = lastLoginAt ? (lastLoginAt >= thirtyDaysAgo && user?.isActive) : false;
      
      return {
        ...patientData,
        ...user,
        isActive: isActuallyActive,
        lastLoginAt: user?.lastLoginAt || null,
        createdAt: user?.createdAt || patientData.createdAt,
        updatedAt: user?.updatedAt || patientData.updatedAt,
        accesses: user?.patientAccessesAsPatient || [],
      };
    });

    res.json({ patients: flattenedPatients });
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Create user (Admin only)
router.post(
  '/users',
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    body('role').isIn(['SUPPORT', 'BASIC']), // Prevent ADMIN creation via this endpoint
    body('phone').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, firstName, lastName, role, phone } = req.body;

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }

      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Generate invite token (UUID)
      const inviteToken = crypto.randomUUID();
      const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          userType: 'OPERATOR',
          role,
          mustChangePassword: false,
          inviteToken,
          inviteTokenExpiresAt,
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'User',
          resourceId: user.id,
          details: { email, role },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      // Send welcome email (non-blocking)
      try {
        const { emailService } = await import('../utils/emailService');
        await emailService.sendOperatorWelcomeEmail(
          email,
          firstName,
          tempPassword,
          inviteToken,
          role
        );
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json({
        user,
        tempPassword, // Return for admin to provide to user manually
        inviteToken, // Also return invite token
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// Create patient (Admin only)
router.post(
  '/patients',
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    body('phone').optional().isString(),
    body('dateOfBirth').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, firstName, lastName, phone, dateOfBirth, medicalHistory, allergies, medications, previousTreatments, notes } = req.body;

      // Check if user with this email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }

      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Generate invite token (UUID)
      const inviteToken = crypto.randomUUID();
      const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Create User first, then Patient profile in a transaction
      const patient = await prisma.$transaction(async (tx) => {
        // Create User with userType=PATIENT
        const user = await tx.user.create({
          data: {
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            userType: 'PATIENT',
            role: 'BASIC',
            isActive: true,
            mustChangePassword: false,
            inviteToken,
            inviteTokenExpiresAt,
          },
        });

        // Create Patient profile with same ID as User
        const patient = await tx.patient.create({
          data: {
            id: user.id, // Patient.id = User.id
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            isInTreatment: true,
            medicalHistory: medicalHistory || null,
            allergies: allergies || null,
            medications: medications || null,
            previousTreatments: previousTreatments || null,
            notes: notes || null,
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                profileImage: true,
                userType: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

        return patient;
      });

    // Flatten patient data: merge user fields into patient object
    if (!patient || typeof patient !== 'object' || !('user' in patient)) {
      return res.status(500).json({ error: 'Invalid patient data returned from database' });
    }
    const { user, ...patientData } = patient as any;
    if (!user) {
      return res.status(500).json({ error: 'Patient user data is missing' });
    }
    const lastLoginAt = user?.lastLoginAt ? new Date(user.lastLoginAt) : null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // CRITICAL FIX: Patients who've never logged in show as inactive, not active
    const isActuallyActive = lastLoginAt ? (lastLoginAt >= thirtyDaysAgo && user?.isActive) : false;
    
    const flattenedPatient = {
      ...patientData,
      ...user,
      isActive: isActuallyActive,
      lastLoginAt: user?.lastLoginAt || null,
      createdAt: user?.createdAt || patientData.createdAt,
      updatedAt: user?.updatedAt || patientData.updatedAt,
    };

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'Patient',
          resourceId: patient.id,
          details: { email },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      // Send welcome email (non-blocking)
      try {
        const { emailService } = await import('../utils/emailService');
        await emailService.sendPatientWelcomeEmail(
          email,
          firstName,
          tempPassword,
          inviteToken
        );
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json({
        patient: flattenedPatient,
        tempPassword, // Return for admin to provide to user manually
        inviteToken, // Also return invite token
      });
    } catch (error) {
      console.error('Create patient error:', error);
      res.status(500).json({ error: 'Failed to create patient' });
    }
  }
);

// Update current user's own profile (Settings page)
router.put('/users/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { firstName, lastName, phone, profileImage } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phone !== undefined && { phone }),
        ...(profileImage !== undefined && { profileImage }),
      },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.UPDATE,
      resourceType: 'User',
      resourceId: req.user.id,
      details: { selfUpdate: true },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ user });
  } catch (error) {
    console.error('Update user (me) error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update user
router.put(
  '/users/:userId',
  [
    body('firstName').optional().notEmpty(),
    body('lastName').optional().notEmpty(),
    body('email').optional().isEmail(),
    body('role').optional().isIn(['ADMIN', 'SUPPORT', 'BASIC']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.params;
      const { firstName, lastName, phone, role, isActive } = req.body;

      // Prevent self-demotion from ADMIN role
      if (req.user?.id === userId && req.user?.role === 'ADMIN' && role && role !== 'ADMIN') {
        return res.status(400).json({ error: 'Cannot remove your own ADMIN role' });
      }

      // Check if this is the last ADMIN being demoted
      if (role && role !== 'ADMIN') {
        const targetUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!targetUser) {
          return res.status(404).json({ error: 'User not found' });
        }
        if (targetUser.role === 'ADMIN') {
          const adminCount = await prisma.user.count({
            where: { role: 'ADMIN', isActive: true },
          });
          if (adminCount <= 1) {
            return res.status(400).json({ error: 'Cannot demote the last ADMIN user' });
          }
        }
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(phone !== undefined && { phone }),
          ...(role && { role }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.UPDATE,
          resourceType: 'User',
          resourceId: userId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.json({ user });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// Update patient
router.put(
  '/patients/:patientId',
  [body('firstName').optional().notEmpty(), body('lastName').optional().notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const { patientId } = req.params;
      const { firstName, lastName, phone, isInTreatment, isActive } = req.body;

      // Update both User and Patient tables
      const patient = await prisma.$transaction(async (tx) => {
        // Update User table for basic fields
        if (firstName !== undefined || lastName !== undefined || phone !== undefined || isActive !== undefined) {
          await tx.user.update({
            where: { id: patientId },
            data: {
              ...(firstName !== undefined && { firstName }),
              ...(lastName !== undefined && { lastName }),
              ...(phone !== undefined && { phone }),
              ...(isActive !== undefined && { isActive }),
            },
          });
        }

        // Update Patient table for medical fields
        const patient = await tx.patient.update({
          where: { id: patientId },
          data: {
            ...(isInTreatment !== undefined && { isInTreatment }),
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                profileImage: true,
                userType: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

        return patient;
      });

    // Flatten patient data: merge user fields into patient object
    if (!patient || typeof patient !== 'object' || !('user' in patient)) {
      return res.status(500).json({ error: 'Invalid patient data returned from database' });
    }
    const { user, ...patientData } = patient as any;
    if (!user) {
      return res.status(500).json({ error: 'Patient user data is missing' });
    }
    const flattenedPatient = {
      ...patientData,
      ...user, // Spread user fields (firstName, lastName, email, phone, etc.)
      createdAt: user?.createdAt || patientData.createdAt,
      updatedAt: user?.updatedAt || patientData.updatedAt,
    };

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.UPDATE,
          resourceType: 'Patient',
          resourceId: patientId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.json({ patient: flattenedPatient });
    } catch (error) {
      console.error('Update patient error:', error);
      res.status(500).json({ error: 'Failed to update patient' });
    }
  }
);

// Delete user
router.delete('/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { userId } = req.params;
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.UPDATE,
      resourceType: 'User',
      resourceId: userId,
      details: { action: 'DEACTIVATED' },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'User deactivated' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Delete patient
router.delete('/patients/:patientId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { patientId } = req.params;
    // Update User table (isActive is in User table, not Patient)
    await prisma.user.update({
      where: { id: patientId },
      data: { isActive: false },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.UPDATE,
      resourceType: 'Patient',
      resourceId: patientId,
      details: { action: 'DEACTIVATED' },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Patient deactivated' });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
});

// Approve showcase
router.post('/showcase/:showcaseId/approve', async (req: AuthRequest, res: Response) => {
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
      },
    });

    res.json({ showcase });
  } catch (error) {
    console.error('Approve showcase error:', error);
    res.status(500).json({ error: 'Failed to approve showcase' });
  }
});

// Reject showcase
router.post(
  '/showcase/:showcaseId/reject',
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

      res.json({ showcase });
    } catch (error) {
      console.error('Reject showcase error:', error);
      res.status(500).json({ error: 'Failed to reject showcase' });
    }
  }
);

// Update content
router.put('/content/:contentId', async (req: AuthRequest, res: Response) => {
  try {
    const { contentId } = req.params;
    const { title, description, isPublic } = req.body;

    const content = await prisma.content.update({
      where: { id: contentId },
      data: {
        title,
        description,
        isPublic,
      },
    });

    res.json({ content });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Regenerate invite token for user
router.post('/users/:email/regenerate-token', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.params;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.email || !user.firstName || !user.userType) {
      return res.status(500).json({ error: 'User data is incomplete' });
    }

    const inviteToken = crypto.randomUUID();
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.user.update({
      where: { id: user.id },
      data: {
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    // Send email notification (non-blocking)
    try {
      const { emailService } = await import('../utils/emailService');
      await emailService.sendInviteTokenRegeneratedEmail(
        user.email,
        user.firstName,
        inviteToken,
        user.userType
      );
    } catch (emailError) {
      console.error('Failed to send invite token email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ inviteToken });
  } catch (error) {
    console.error('Regenerate user token error:', error);
    res.status(500).json({ error: 'Failed to regenerate token' });
  }
});

// Regenerate invite token for patient
router.post('/patients/:email/regenerate-token', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.params;
    
    // Find user by email (Patient is now a profile extension)
    const user = await prisma.user.findUnique({ 
      where: { email },
      include: {
        patientProfile: true,
      },
    });
    
    if (!user || user.userType !== 'PATIENT' || !user.patientProfile) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!user.email || !user.firstName || !user.userType) {
      return res.status(500).json({ error: 'Patient user data is incomplete' });
    }

    const inviteToken = crypto.randomUUID();
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Update User table (inviteToken is in User table)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    // Send email notification (non-blocking)
    try {
      const { emailService } = await import('../utils/emailService');
      await emailService.sendInviteTokenRegeneratedEmail(
        user.email,
        user.firstName,
        inviteToken,
        user.userType
      );
    } catch (emailError) {
      console.error('Failed to send invite token email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ inviteToken });
  } catch (error) {
    console.error('Regenerate patient token error:', error);
    res.status(500).json({ error: 'Failed to regenerate token' });
  }
});

// Hard delete user account (GDPR Right to Erasure)
router.delete(
  '/users/:userId/hard-delete',
  [body('confirmEmail').notEmpty().withMessage('Email confirmation required')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.params;
      const { confirmEmail } = req.body;

      // Get user to verify email
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, role: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify email confirmation
      if (user.email !== confirmEmail) {
        return res.status(400).json({ error: 'Email confirmation does not match' });
      }

      // Prevent deleting the last ADMIN
      if (user.role === 'ADMIN') {
        const adminCount = await prisma.user.count({
          where: { role: 'ADMIN', isActive: true },
        });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last ADMIN user' });
        }
      }

      // Log deletion before actually deleting
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.DELETE,
          resourceType: 'User',
          resourceId: userId,
          details: { email: user.email, hardDelete: true },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      // Hard delete user (cascade will handle related records)
      await prisma.user.delete({
        where: { id: userId },
      });

      res.json({ message: 'User account permanently deleted' });
    } catch (error) {
      console.error('Hard delete user error:', error);
      res.status(500).json({ error: 'Failed to delete user account' });
    }
  }
);

// Manual file cleanup (admin only)
router.post('/cleanup/files', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { runFullCleanup } = require('../utils/fileCleanup');
    
    const result = await runFullCleanup();

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'FileCleanup',
      details: result,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ 
      message: 'File cleanup completed',
      result,
    });
  } catch (error) {
    console.error('File cleanup error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to run file cleanup: ${errorMessage}` });
  }
});

export default router;


