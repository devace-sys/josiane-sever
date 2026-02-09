import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { auditLogger } from '../utils/auditLogger';
import crypto from 'crypto';
import { passwordValidation } from '../utils/validation';

const router = express.Router();
const prisma = new PrismaClient();

// Register Operator
router.post(
  '/register-operator',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: passwordValidation.minLength }).matches(passwordValidation.regex).withMessage(passwordValidation.message),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    body('role').isIn(['SUPPORT', 'BASIC']), // ADMIN role cannot be registered through public registration
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, firstName, lastName, phone, role } = req.body;
      
      // Null checks for required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ error: 'Missing required fields: email, password, firstName, lastName' });
      }

      // Additional security check: prevent ADMIN role registration
      if (role === 'ADMIN') {
        return res.status(403).json({ error: 'Administrator accounts cannot be created through public registration' });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          userType: 'OPERATOR',
          role: role || 'BASIC',
        },
      });

      const token = jwt.sign(
        { id: user.id, email: user.email, userType: 'OPERATOR', role: user.role },
        process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
        { expiresIn: '24h' } // SECURITY: Reduced from 7d to 24h
      );

      res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          role: user.role,
          userType: 'OPERATOR',
        },
      });
    } catch (error) {
      console.error('Register operator error:', error);
      res.status(500).json({ error: 'Failed to register operator' });
    }
  }
);

// Register Patient
router.post(
  '/register-patient',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: passwordValidation.minLength }).matches(passwordValidation.regex).withMessage(passwordValidation.message),
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, firstName, lastName, phone, dateOfBirth } = req.body;
      
      // Null checks for required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ error: 'Missing required fields: email, password, firstName, lastName' });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create User first, then Patient profile in a transaction
      const result = await prisma.$transaction(async (tx) => {
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
          },
        });

        // Create Patient profile with same ID as User
        const patient = await tx.patient.create({
          data: {
            id: user.id, // Patient.id = User.id
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            isInTreatment: true,
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

        return { user, patient };
      });

      const token = jwt.sign(
        { id: result.user.id, email: result.user.email, userType: 'PATIENT' },
        process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
        { expiresIn: '24h' } // SECURITY: Reduced from 7d to 24h
      );

      res.status(201).json({
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          phone: result.user.phone,
          dateOfBirth: result.patient.dateOfBirth,
          userType: 'PATIENT',
        },
      });
    } catch (error) {
      console.error('Register patient error:', error);
      res.status(500).json({ error: 'Failed to register patient' });
    }
  }
);

// Login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
    body('userType').isIn(['PATIENT', 'OPERATOR']),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, userType } = req.body;

      // ALL users (patients and operators) are in the User table
      const user = await prisma.user.findUnique({ 
        where: { email },
        include: {
          patientProfile: userType === 'PATIENT',
        },
      });

      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify userType matches
      if (user.userType !== userType) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (userType === 'PATIENT') {
        // Update lastLoginAt
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const token = jwt.sign(
          { id: user.id, email: user.email, userType: 'PATIENT', firstName: user.firstName, lastName: user.lastName },
          process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
          { expiresIn: '24h' } // SECURITY: Reduced from 7d to 24h
        );

        // Log login
        await auditLogger.log({
          userId: user.id,
          userType: 'PATIENT',
          action: AuditAction.LOGIN,
          resourceType: 'Auth',
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });

        return res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            dateOfBirth: user.patientProfile?.dateOfBirth,
            profileImage: user.profileImage,
            isInTreatment: user.patientProfile?.isInTreatment,
            mustChangePassword: user.mustChangePassword,
            userType: 'PATIENT',
          },
        });
      } else {
        // Operator login
        // Check role is not null (workflow requirement)
        if (!user.role) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Note: ADMIN role blocking is handled on the client side
        // - Mobile app blocks ADMIN in AuthContext (JosianeApp)
        // - Web panel allows ADMIN in authService (admin-panel)
        // This allows both clients to handle their own access control

        // Update lastLoginAt
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const token = jwt.sign(
          { id: user.id, email: user.email, userType: 'OPERATOR', role: user.role, firstName: user.firstName, lastName: user.lastName },
          process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
          { expiresIn: '24h' } // SECURITY: Reduced from 7d to 24h
        );

        // Log login
        await auditLogger.log({
          userId: user.id,
          userType: 'OPERATOR',
          action: AuditAction.LOGIN,
          resourceType: 'Auth',
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });

        return res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            profileImage: user.profileImage,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
            userType: 'OPERATOR',
          },
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to login' });
    }
  }
);

// Get Current User
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user with patient profile if patient
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        patientProfile: req.user.userType === 'PATIENT',
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.userType === 'PATIENT') {
      return res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          dateOfBirth: user.patientProfile?.dateOfBirth,
          profileImage: user.profileImage,
          isInTreatment: user.patientProfile?.isInTreatment,
          mustChangePassword: user.mustChangePassword,
          medicalHistory: user.patientProfile?.medicalHistory,
          allergies: user.patientProfile?.allergies,
          medications: user.patientProfile?.medications,
          previousTreatments: user.patientProfile?.previousTreatments,
          notes: user.patientProfile?.notes,
          userType: 'PATIENT',
        },
      });
    } else {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          profileImage: true,
          role: true,
          mustChangePassword: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({
        user: {
          ...user,
          userType: 'OPERATOR',
        },
      });
    }
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update Profile
router.put(
  '/me',
  authenticateToken,
  [body('firstName').optional().notEmpty(), body('lastName').optional().notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { firstName, lastName, phone, profileImage } = req.body;
      
      // Validate that at least one field is provided for update
      if (firstName === undefined && lastName === undefined && phone === undefined && profileImage === undefined) {
        return res.status(400).json({ error: 'At least one field must be provided for update' });
      }

      if (req.user.userType === 'PATIENT') {
        // Update User table for basic fields, Patient profile remains unchanged
        const user = await prisma.user.update({
          where: { id: req.user.id },
          data: {
            firstName,
            lastName,
            phone,
            profileImage,
          },
          include: {
            patientProfile: true,
          },
        });

        return res.json({
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            profileImage: user.profileImage,
            dateOfBirth: user.patientProfile?.dateOfBirth,
            isInTreatment: user.patientProfile?.isInTreatment,
            medicalHistory: user.patientProfile?.medicalHistory,
            allergies: user.patientProfile?.allergies,
            medications: user.patientProfile?.medications,
            previousTreatments: user.patientProfile?.previousTreatments,
            notes: user.patientProfile?.notes,
            mustChangePassword: user.mustChangePassword,
            userType: 'PATIENT',
          },
        });
      } else {
        const user = await prisma.user.update({
          where: { id: req.user.id },
          data: {
            firstName,
            lastName,
            phone,
            profileImage,
          },
        });

        return res.json({
          user: {
            ...user,
            userType: 'OPERATOR',
          },
        });
      }
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// Forgot Password
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail(), body('userType').isIn(['PATIENT', 'OPERATOR'])],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, userType } = req.body;

      // ALL users (patients and operators) are in the User table
      const user = await prisma.user.findUnique({ 
        where: { email },
        include: {
          patientProfile: userType === 'PATIENT',
        },
      });

      if (!user || user.userType !== userType) {
        // Don't reveal if email exists
        return res.json({ message: 'If email exists, reset link sent' });
      }

      // Generate reset token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

      // Delete existing unused reset tokens for this email
      await prisma.passwordReset.deleteMany({
        where: { 
          email: email,
          used: false,
        },
      });

      // Create new reset token
      await prisma.passwordReset.create({
        data: {
          email,
          token,
          expiresAt,
          used: false,
        },
      });

      // Send email with reset link
      try {
        const { emailService } = await import('../utils/emailService');
        await emailService.sendPasswordResetEmail(email, token, userType);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // Don't fail the request if email fails - still return success for security
      }

      // In development, also return token for testing
      if (process.env.NODE_ENV === 'development') {
        return res.json({
          message: 'Reset token generated and email sent',
          token, // Only in development
        });
      }

      res.json({ message: 'If email exists, reset link sent' });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  }
);

// Reset Password
router.post(
  '/reset-password',
  [
    body('token').notEmpty(),
    body('password').isLength({ min: passwordValidation.minLength }).matches(passwordValidation.regex).withMessage(passwordValidation.message),
    body('userType').isIn(['PATIENT', 'OPERATOR']),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token, password, userType } = req.body;

      const resetRecord = await prisma.passwordReset.findUnique({
        where: { token },
      });

      if (!resetRecord || resetRecord.used || resetRecord.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }

      // Find user by email from reset record
      const user = await prisma.user.findUnique({
        where: { email: resetRecord.email },
        select: { id: true, userType: true },
      });

      if (!user || user.userType !== userType) {
        return res.status(400).json({ error: 'Invalid token for this user type' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Update password and reset mustChangePassword flag
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          password: hashedPassword,
          mustChangePassword: false,
        },
      });

      // Mark token as used instead of deleting (for audit trail)
      await prisma.passwordReset.update({ 
        where: { id: resetRecord.id },
        data: { used: true },
      });

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

// Accept Invite (Patient onboarding)
router.post(
  '/accept-invite',
  [
    body('inviteToken').notEmpty().withMessage('Invite token is required'),
    body('password').isLength({ min: passwordValidation.minLength }).matches(passwordValidation.regex).withMessage(passwordValidation.message),
    body('termsAccepted').isBoolean().withMessage('Terms acceptance is required'),
    body('privacyAccepted').isBoolean().withMessage('Privacy acceptance is required'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { inviteToken, password, termsAccepted, privacyAccepted } = req.body;

      if (!termsAccepted || !privacyAccepted) {
        return res.status(400).json({ error: 'Terms and Privacy policy must be accepted' });
      }

      // Find user by invite token
      const user = await prisma.user.findUnique({
        where: { inviteToken },
        include: { patientProfile: true },
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid invite token' });
      }

      // Check if token is expired
      if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
        return res.status(400).json({ error: 'Invite token has expired. Please request a new invite.' });
      }

      // Verify userType is PATIENT
      if (user.userType !== 'PATIENT') {
        return res.status(400).json({ error: 'Invalid invite token for patient' });
      }

      // Check if token was already used (password already set and mustChangePassword is false)
      if (!user.mustChangePassword && user.password !== '') {
        return res.status(400).json({ error: 'Invite already accepted' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update user and create Patient profile if missing
      const updatedUser = await prisma.$transaction(async (tx) => {
        // Update User: set password, clear invite token, set mustChangePassword to false
        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            password: hashedPassword,
            mustChangePassword: false,
            inviteToken: null,
            inviteTokenExpiresAt: null,
            isActive: true,
          },
        });

        // Create Patient profile if missing
        const existingPatient = await tx.patient.findUnique({
          where: { id: user.id },
        });

        if (!existingPatient) {
          await tx.patient.create({
            data: {
              id: user.id,
              isInTreatment: true,
            },
          });
        }

        return updated;
      });

      // Log audit
      await auditLogger.log({
        userId: updatedUser.id,
        userType: 'PATIENT',
        action: AuditAction.LOGIN,
        resourceType: 'Auth',
        details: { action: 'invite_accepted' },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Generate JWT token
      const token = jwt.sign(
        { id: updatedUser.id, email: updatedUser.email, userType: 'PATIENT' },
        process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
        { expiresIn: '24h' } // SECURITY: Reduced from 7d to 24h
      );

      // Get patient profile
      const patientProfile = await prisma.patient.findUnique({
        where: { id: updatedUser.id },
      });

      res.status(200).json({
        token,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          phone: updatedUser.phone,
          dateOfBirth: patientProfile?.dateOfBirth,
          profileImage: updatedUser.profileImage,
          isInTreatment: patientProfile?.isInTreatment,
          mustChangePassword: false,
          userType: 'PATIENT',
        },
      });
    } catch (error) {
      console.error('Accept invite error:', error);
      res.status(500).json({ error: 'Failed to accept invite' });
    }
  }
);

// Change Password
router.put(
  '/change-password',
  authenticateToken,
  [
    body('currentPassword').optional().notEmpty().withMessage('Current password is required if not first login'),
    body('newPassword').isLength({ min: passwordValidation.minLength }).matches(passwordValidation.regex).withMessage(passwordValidation.message),
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

      const { currentPassword, newPassword } = req.body;

      // ALL users (patients and operators) are in the User table
      const userRecord = await prisma.user.findUnique({ 
        where: { id: req.user.id },
        select: {
          password: true,
          mustChangePassword: true,
        },
      });

      if (!userRecord) {
        return res.status(404).json({ error: 'User not found' });
      }

      // If mustChangePassword is true (first login), currentPassword is optional
      // Otherwise, currentPassword is required
      if (!userRecord.mustChangePassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required' });
        }
        const isValidPassword = await bcrypt.compare(currentPassword, userRecord.password);
        if (!isValidPassword) {
          return res.status(401).json({ error: 'Invalid current password' });
        }
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // ALL users (patients and operators) are in the User table
      await prisma.user.update({
        where: { id: req.user.id },
        data: { 
          password: hashedPassword,
          mustChangePassword: false, // Clear the flag after password change
        },
      });

      // Log password change
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.PASSWORD_CHANGED,
        resourceType: 'Auth',
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

export default router;

