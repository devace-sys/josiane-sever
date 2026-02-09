import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { checkPatientAccess } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';
import { sendNotification, NotificationType } from '../utils/notificationHelper';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const prisma = new PrismaClient();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads/patient-uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for patient uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'patient-upload-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (workflow requirement)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Get patient uploads
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const { status, uploadType } = req.query;

    const where: any = { patientId };
    if (status) {
      where.status = status;
    }
    if (uploadType) {
      where.uploadType = uploadType;
    }

    const uploads = await prisma.patientUpload.findMany({
      where,
      include: {
        reviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        session: {
          select: {
            id: true,
            date: true,
          },
        },
        replies: {
          include: {
            operator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({ uploads });
  } catch (error) {
    console.error('Get patient uploads error:', error);
    res.status(500).json({ error: 'Failed to fetch patient uploads' });
  }
});

// Patient uploads a photo (recovery, progress, reaction)
router.post(
  '/patient/:patientId',
  authenticateToken,
  checkPatientAccess,
  upload.single('file'),
  [
    body('uploadType').isIn(['RECOVERY', 'PROGRESS', 'REACTION']),
    body('description').optional().isString(),
    body('sessionId').optional().isString(),
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

      // Check if patient uploads are enabled
      const config = await (prisma as any).clinicConfig.findFirst();
      if (config && !config.featurePatientUploadsEnabled) {
        return res.status(403).json({ error: 'Patient uploads are disabled' });
      }

      // Only patients can upload
      if (req.user.userType !== 'PATIENT' || req.user.id !== req.params.patientId) {
        return res.status(403).json({ error: 'Only patients can upload their own photos' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { patientId } = req.params;
      const { uploadType, description, sessionId } = req.body;

      // Validate sessionId if provided (must belong to patient)
      if (sessionId) {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { patientId: true },
        });

        if (!session || session.patientId !== patientId) {
          return res.status(400).json({ error: 'Invalid session ID or session does not belong to patient' });
        }
      }

      const patientUpload = await prisma.patientUpload.create({
        data: {
          patientId,
          uploadType,
          filePath: `/uploads/patient-uploads/${req.file.filename}`,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          description,
          status: 'PENDING',
          sessionId: sessionId || null,
        },
        include: {
          // PatientUpload.patient references User directly (not Patient)
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

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.FILE_UPLOADED,
        resourceType: 'PatientUpload',
        resourceId: patientUpload.id,
        details: { uploadType, fileName: req.file.originalname },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Send notification to operators with access to this patient
      const patientAccesses = await prisma.patientAccess.findMany({
        where: { patientId, canView: true },
        select: { operatorId: true },
      });

      if (!patientUpload.patient || !patientUpload.patient.firstName || !patientUpload.patient.lastName) {
        return res.status(500).json({ error: 'Invalid patient data' });
      }
      const patientName = `${patientUpload.patient.firstName} ${patientUpload.patient.lastName}`;
      for (const access of patientAccesses) {
        await sendNotification({
          userId: access.operatorId,
          title: 'New Patient Upload',
          message: `${patientName} uploaded a ${uploadType.toLowerCase()} photo`,
          type: NotificationType.UPLOAD_SUBMITTED,
          data: { uploadId: patientUpload.id, patientId, uploadType },
        });
      }

      res.status(201).json({ upload: patientUpload });
    } catch (error) {
      console.error('Create patient upload error:', error);
      res.status(500).json({ error: 'Failed to upload photo' });
    }
  }
);

// Operator reviews patient upload
router.put(
  '/:uploadId/review',
  authenticateToken,
  [
    body('status').isIn(['PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'ATTACHED_TO_SESSION']),
    body('sessionId').optional().isString(),
    body('rejectionReason').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { status, sessionId, rejectionReason } = req.body;

      // Validate that sessionId is provided when status is ATTACHED_TO_SESSION
      if (status === 'ATTACHED_TO_SESSION' && !sessionId) {
        return res.status(400).json({ error: 'Session ID is required when attaching upload to session' });
      }

      // Validate that rejectionReason is provided when status is REJECTED
      if (status === 'REJECTED' && !rejectionReason) {
        return res.status(400).json({ error: 'Rejection reason is required when rejecting upload' });
      }

      if (!req.user || req.user.userType === 'PATIENT') {
        return res.status(403).json({ error: 'Only operators can review uploads' });
      }

      const { uploadId } = req.params;

      const upload = await prisma.patientUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      // Validate status transitions
      const validTransitions: Record<string, string[]> = {
        'PENDING': ['REVIEWED', 'APPROVED', 'REJECTED', 'ATTACHED_TO_SESSION'],
        'REVIEWED': ['APPROVED', 'REJECTED', 'ATTACHED_TO_SESSION'],
        'APPROVED': ['ATTACHED_TO_SESSION'],
        'REJECTED': [], // Cannot transition from rejected
        'ATTACHED_TO_SESSION': [], // Cannot transition from attached
      };

      const currentStatus = upload.status;
      const allowedNextStatuses = validTransitions[currentStatus] || [];

      if (!allowedNextStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status transition from ${currentStatus} to ${status}`,
          allowedTransitions: allowedNextStatuses,
        });
      }

      // Validate session exists and belongs to patient if attaching
      if (status === 'ATTACHED_TO_SESSION' && sessionId) {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        if (session.patientId !== upload.patientId) {
          return res.status(400).json({ error: 'Session does not belong to this patient' });
        }

        // Check operator has access to the session
        if (req.user && req.user.role !== 'ADMIN') {
          const hasAccess = await prisma.patientAccess.findUnique({
            where: {
              patientId_operatorId: {
                patientId: session.patientId,
                operatorId: req.user.id,
              },
            },
          });

          if (!hasAccess || !hasAccess.canEdit) {
            return res.status(403).json({ error: 'You do not have edit permission for this patient' });
          }
        }
      }

      // Check access to patient
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: upload.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (req.user.role !== 'ADMIN' && !hasAccess) {
        return res.status(403).json({ error: 'No access to this patient' });
      }

      const updatedUpload = await prisma.patientUpload.update({
        where: { id: uploadId },
        data: {
          status,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          ...(sessionId && { sessionId }),
          ...(status === 'REJECTED' && rejectionReason && { rejectionReason }),
        },
        include: {
          reviewer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          session: {
            select: {
              id: true,
              date: true,
            },
          },
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.UPDATE,
        resourceType: 'PatientUpload',
        resourceId: uploadId,
        details: { status, sessionId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Send notification to patient about review
      if (!updatedUpload.reviewer) {
        return res.status(500).json({ error: 'Reviewer information is missing' });
      }
      const reviewerName = `${updatedUpload.reviewer.firstName || ''} ${updatedUpload.reviewer.lastName || ''}`.trim();
      
      const getNotificationDetails = (status: string) => {
        if (status === 'APPROVED') {
          return {
            title: 'Upload Approved',
            message: `${reviewerName} approved your upload`,
            type: NotificationType.UPLOAD_APPROVED,
          };
        } else if (status === 'REJECTED') {
          return {
            title: 'Upload Rejected',
            message: rejectionReason || `${reviewerName} rejected your upload`,
            type: NotificationType.UPLOAD_REJECTED,
          };
        } else if (status === 'ATTACHED_TO_SESSION') {
          return {
            title: 'Upload Added to Session',
            message: `${reviewerName} added your upload to a session`,
            type: NotificationType.UPLOAD_REVIEWED, // Use existing type for attached
          };
        } else {
          return {
            title: 'Upload Reviewed',
            message: `${reviewerName} reviewed your upload`,
            type: NotificationType.UPLOAD_REVIEWED,
          };
        }
      };

      const notifDetails = getNotificationDetails(status);
      await sendNotification({
        userId: upload.patientId,
        title: notifDetails.title,
        message: notifDetails.message,
        type: notifDetails.type,
        data: { uploadId, status, sessionId },
      });

      res.json({ upload: updatedUpload });
    } catch (error) {
      console.error('Review patient upload error:', error);
      res.status(500).json({ error: 'Failed to review upload' });
    }
  }
);

// Operator replies to patient upload
router.post(
  '/:uploadId/reply',
  authenticateToken,
  [body('content').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user || req.user.userType === 'PATIENT') {
        return res.status(403).json({ error: 'Only operators can reply to uploads' });
      }

      const { uploadId } = req.params;
      const { content } = req.body;

      const upload = await prisma.patientUpload.findUnique({
        where: { id: uploadId },
      });

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      // Check access to patient
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: upload.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (req.user.role !== 'ADMIN' && !hasAccess) {
        return res.status(403).json({ error: 'No access to this patient' });
      }

      const reply = await prisma.patientUploadReply.create({
        data: {
          patientUploadId: uploadId,
          operatorId: req.user.id,
          content,
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
        resourceType: 'PatientUploadReply',
        resourceId: reply.id,
        details: { patientUploadId: uploadId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.status(201).json({ reply });
    } catch (error) {
      console.error('Reply to upload error:', error);
      res.status(500).json({ error: 'Failed to reply to upload' });
    }
  }
);

// Delete patient upload
router.delete('/:uploadId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { uploadId } = req.params;

    const upload = await prisma.patientUpload.findUnique({
      where: { id: uploadId },
    });

    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Patients can delete their own uploads, operators can delete if they have access
    if (req.user.userType === 'PATIENT') {
      if (req.user.id !== upload.patientId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: upload.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (req.user.role !== 'ADMIN' && !hasAccess) {
        return res.status(403).json({ error: 'No access to this patient' });
      }
    }

    // Delete file from filesystem
    if (!upload.filePath) {
      return res.status(400).json({ error: 'File path is missing' });
    }
    // Use stored path directly (already includes /uploads/patient-uploads/)
    const filePath = path.join(__dirname, '../../', upload.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.patientUpload.delete({
      where: { id: uploadId },
    });

    res.json({ message: 'Upload deleted successfully' });
  } catch (error) {
    console.error('Delete patient upload error:', error);
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

export default router;

