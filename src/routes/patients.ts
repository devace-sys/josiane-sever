import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess, checkCanEdit } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';
import { sendNotification, NotificationType } from '../utils/notificationHelper';
import { flattenPatientData, flattenPatientArray, flattenPatientDetailFromUser } from '../utils/patientHelpers';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { patientRepository, prisma } from '../repositories';

const router = express.Router();

// Get all patients (operators only)
router.get('/', authenticateToken, requireRole('ADMIN', 'SUPPORT', 'BASIC'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let patients;
    if (req.user.role === 'ADMIN') {
      patients = await patientRepository.findAll();
      // Note: isActive filtering is already done in the repository where clause
    } else {
      patients = await patientRepository.getAccessiblePatients(req.user.id);
      // Note: isActive filtering is already done in the repository where clause
    }

    // Flatten patient data: merge user fields into patient object for frontend compatibility
    const flattenedPatients = flattenPatientArray(patients);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Apply pagination
    const paginatedPatients = flattenedPatients.slice(skip, skip + limit);
    const total = flattenedPatients.length;

    res.setHeader('Cache-Control', 'no-cache');
    res.json({ 
      patients: paginatedPatients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get patients error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch patients: ${errorMessage}` });
  }
});

// Get patient by ID (with assigned operators for detail dialog)
router.get('/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const operatorId = req.user?.role === 'ADMIN' ? undefined : req.user?.id;
    const repo = patientRepository as typeof patientRepository & { findUserWithAccesses(id: string, operatorId?: string): Promise<any> };
    const userWithAccesses = await repo.findUserWithAccesses(patientId, operatorId);

    if (!userWithAccesses) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const flattenedPatient = flattenPatientDetailFromUser(userWithAccesses);
    if (!flattenedPatient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({ patient: flattenedPatient });
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Create patient (operators only)
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    body('phone').optional().matches(/^[\d\s\-\+\(\)]{10,}$/).withMessage('Invalid phone format'),
    body('dateOfBirth').optional().isISO8601().custom((value) => {
      if (value) {
        const dob = new Date(value);
        const today = new Date();
        if (dob > today) {
          throw new Error('Date of birth cannot be in the future');
        }
      }
      return true;
    }),
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

      const { email, firstName, lastName, phone, dateOfBirth, medicalHistory, allergies, medications, previousTreatments, notes } = req.body;

      // Check if user with this email already exists
      const existingUser = await patientRepository.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Generate invite token (UUID)
      const inviteToken = crypto.randomUUID();
      const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // CRITICAL FIX: Create patient and grant access in transaction to prevent orphaned patients
      const { patient } = await prisma.$transaction(async (tx: any) => {
        // Create User first (with userType=PATIENT), then Patient profile
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
        const patientProfile = await tx.patient.create({
          data: {
            id: user.id,
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            isInTreatment: true,
            medicalHistory,
            allergies,
            medications,
            previousTreatments,
            notes,
          },
        });

        // Grant access to creator
        await tx.patientAccess.upsert({
          where: {
            patientId_operatorId: {
              patientId: user.id,
              operatorId: req.user!.id,
            },
          },
          create: {
            patientId: user.id,
            operatorId: req.user!.id,
            canView: true,
            canEdit: true,
          },
          update: {
            canView: true,
            canEdit: true,
          },
        });

        return { patient: { ...patientProfile, ...user } };
      });

      // Get patient with user data to flatten
      const patientWithUser = await patientRepository.findById(patient.id);
      
      // Flatten patient data: merge user fields into patient object
      let flattenedPatient = patient;
      if (patientWithUser) {
        const { user, ...patientData } = patientWithUser as any;
        flattenedPatient = {
          ...patientData,
          ...user, // Spread user fields (firstName, lastName, email, phone, etc.)
          createdAt: user?.createdAt || patientData.createdAt,
          updatedAt: user?.updatedAt || patientData.updatedAt,
        } as any;
      }

      // Log patient creation
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.CREATE,
        resourceType: 'Patient',
        resourceId: patient.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.status(201).json({
        patient: flattenedPatient,
        tempPassword, // Return for operator to provide to patient
        inviteToken, // Also return invite token
      });
    } catch (error) {
      console.error('Create patient error:', error);
      res.status(500).json({ error: 'Failed to create patient' });
    }
  }
);

// Update patient profile by patient (workflow format: PATCH /patients/me)
router.patch(
  '/me',
  authenticateToken,
  [
    body('phone').optional().matches(/^[\d\s\-\+\(\)]{10,}$/).withMessage('Invalid phone format'),
    body('dateOfBirth').optional().isISO8601().custom((value) => {
      if (value) {
        const dob = new Date(value);
        const today = new Date();
        if (dob > today) {
          throw new Error('Date of birth cannot be in the future');
        }
      }
      return true;
    }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user || req.user.userType !== 'PATIENT') {
        return res.status(403).json({ error: 'Patient access required' });
      }

      const patientId = req.user.id;
      const { phone, dateOfBirth } = req.body;

      // Patients can only edit "safe" fields: phone, DOB
      // Medical fields (medicalHistory, allergies, medications, previousTreatments, notes) are read-only for patients
      
      // Validate dateOfBirth if provided
      let validatedDateOfBirth: Date | null | undefined = undefined;
      if (dateOfBirth !== undefined) {
        if (dateOfBirth === null || dateOfBirth === '') {
          validatedDateOfBirth = null;
        } else {
          const parsedDate = new Date(dateOfBirth);
          if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: 'Invalid dateOfBirth format' });
          }
          // Validate date is not in the future
          if (parsedDate > new Date()) {
            return res.status(400).json({ error: 'Date of birth cannot be in the future' });
          }
          validatedDateOfBirth = parsedDate;
        }
      }
      
      // Update User table for phone
      const updatedUser = await patientRepository.update(patientId, {
        phone: phone !== undefined ? phone : undefined,
        dateOfBirth: validatedDateOfBirth,
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: 'PATIENT',
        action: AuditAction.UPDATE,
        resourceType: 'Patient',
        resourceId: patientId,
        details: { fields: ['phone', 'dateOfBirth'] },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ patient: updatedUser });
    } catch (error) {
      console.error('Update patient profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// Update patient (by operators/doctors)
router.put(
  '/:patientId',
  authenticateToken,
  checkPatientAccess,
  checkCanEdit,
  [body('firstName').optional().notEmpty(), body('lastName').optional().notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const { patientId } = req.params;
      const { firstName, lastName, phone, dateOfBirth, isInTreatment, medicalHistory, allergies, medications, previousTreatments, notes } = req.body;

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // ADMIN cannot edit patient medical data
      if (req.user.role === 'ADMIN') {
        return res.status(403).json({ error: 'Admin cannot edit patient medical data' });
      }

      // Validate dateOfBirth if provided
      let validatedDateOfBirth: Date | undefined = undefined;
      if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== '') {
        const parsedDate = new Date(dateOfBirth);
        if (isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'Invalid dateOfBirth format' });
        }
        // Validate date is not in the future
        if (parsedDate > new Date()) {
          return res.status(400).json({ error: 'Date of birth cannot be in the future' });
        }
        validatedDateOfBirth = parsedDate;
      }
      
      // Update User table for basic fields, Patient table for medical fields
      const patient = await patientRepository.update(patientId, {
        firstName,
        lastName,
        phone,
        dateOfBirth: validatedDateOfBirth,
        isInTreatment,
        medicalHistory,
        allergies,
        medications,
        previousTreatments,
        notes,
      });

      // Get updated patient with user data to flatten
      const patientWithUser = await patientRepository.findById(patientId);
      
      // Flatten patient data: merge user fields into patient object
      let flattenedPatient = patient;
      if (patientWithUser) {
        const { user, ...patientData } = patientWithUser as any;
        flattenedPatient = {
          ...patientData,
          ...user, // Spread user fields (firstName, lastName, email, phone, etc.)
          createdAt: user?.createdAt || patientData.createdAt,
          updatedAt: user?.updatedAt || patientData.updatedAt,
        } as any;
      }

      // Log patient update
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.UPDATE,
        resourceType: 'Patient',
        resourceId: patientId,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ patient: flattenedPatient });
    } catch (error) {
      console.error('Update patient error:', error);
      res.status(500).json({ error: 'Failed to update patient' });
    }
  }
);

// Grant/revoke access (admin only)
router.post(
  '/:patientId/access',
  authenticateToken,
  requireRole('ADMIN'),
  [body('operatorId').notEmpty(), body('canView').isBoolean(), body('canEdit').isBoolean()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { patientId } = req.params;
      const { operatorId, canView, canEdit } = req.body;

      let access;
      if (canView) {
        access = await patientRepository.grantAccess(patientId, operatorId, canEdit);
        
        // Log access granted
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.ACCESS_GRANTED,
          resourceType: 'Patient',
          resourceId: patientId,
          details: { operatorId, canEdit },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
        
        // Send notification to operator about new patient assignment
        const patient = await prisma.user.findUnique({ where: { id: patientId } });
        if (patient) {
          await sendNotification({
            userId: operatorId,
            title: 'New Patient Assigned',
            message: `You've been assigned to ${patient.firstName} ${patient.lastName}`,
            type: 'PATIENT_ASSIGNED',
            data: { patientId, canEdit },
          });
        }
        
        // Send notification to patient about new operator assignment
        await sendNotification({
          userId: patientId,
          title: 'New Care Team Member',
          message: 'A new healthcare professional has been assigned to your care',
          type: 'OPERATOR_ASSIGNED',
          data: { operatorId },
        });
      } else {
        await patientRepository.revokeAccess(patientId, operatorId);
        
        // Log access revoked
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.ACCESS_REVOKED,
          resourceType: 'Patient',
          resourceId: patientId,
          details: { operatorId },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
        
        // Return a mock access object for consistency
        access = {
          id: '',
          patientId,
          operatorId,
          canView: false,
          canEdit: false,
          createdAt: new Date(),
        };
      }

      res.json({ access });
    } catch (error) {
      console.error('Grant access error:', error);
      res.status(500).json({ error: 'Failed to grant access' });
    }
  }
);

// Revoke access (admin only)
router.delete(
  '/:patientId/access/:operatorId',
  authenticateToken,
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { patientId, operatorId } = req.params;

      await patientRepository.revokeAccess(patientId, operatorId);
      
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.ACCESS_REVOKED,
        resourceType: 'Patient',
        resourceId: patientId,
        details: { operatorId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ message: 'Access revoked successfully' });
    } catch (error) {
      console.error('Revoke access error:', error);
      res.status(500).json({ error: 'Failed to revoke access' });
    }
  }
);

export default router;


