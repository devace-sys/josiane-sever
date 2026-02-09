import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient, Prisma } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess, checkCanEdit } from '../middleware/patientAccess';
import { sessionRepository } from '../repositories';
import { auditLogger } from '../utils/auditLogger';
import { emitSessionEvent } from '../utils/socket';
import { sendNotification, NotificationType } from '../utils/notificationHelper';

const router = express.Router();
const prisma = new PrismaClient();

// Get sessions with query params (supports patientId=me, date filtering, and pagination)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let patientId: string | undefined = req.query.patientId as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Handle patientId=me alias
    if (patientId === 'me') {
      if (req.user.userType === 'PATIENT') {
        patientId = req.user.id;
      } else {
        return res.status(403).json({ error: 'Only patients can use patientId=me' });
      }
    }

    // For patients, they can only see their own sessions
    if (req.user.userType === 'PATIENT') {
      if (!patientId) {
        patientId = req.user.id;
      } else if (patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else {
      // For operators, check access if patientId is specified
      if (patientId) {
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
    }

    // Build query with date filtering
    const where: any = {};
    if (patientId) {
      where.patientId = patientId;
    }
    if (dateFrom) {
      where.date = {
        gte: new Date(dateFrom),
      };
    }

    // Get total count for pagination
    const total = await prisma.session.count({ where });

    const sessions = await prisma.session.findMany({
      where,
      include: {
        patient: {
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
            patientProfile: true,
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: true,
        instructions: true,
        questions: {
          include: {
            asker: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            answerer: {
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
        patientUploads: {
          where: {
            status: 'PENDING',
          },
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
      skip,
      take: limit,
    });

    res.setHeader('Cache-Control', 'no-cache');
    res.json({ 
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch sessions: ${errorMessage}` });
  }
});

// Get sessions for patient (backward compatibility)
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const sessions = await sessionRepository.findAll(patientId);

    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get session by ID
router.get('/:sessionId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        patient: {
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
            patientProfile: true,
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: {
          include: {
            uploader: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        instructions: true,
        questions: {
          include: {
            asker: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            answerer: {
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
        patientUploads: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            reviewer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.role !== 'ADMIN') {
      // Check operator access
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canView) {
        return res.status(403).json({ error: 'No access to this patient' });
      }
    }

    // Get assigned products (PatientProduct) for this patient
    const assignedProducts = await prisma.patientProduct.findMany({
      where: { patientId: session.patientId },
      include: {
        product: true,
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    // Get recommended content (assigned content to patient, could be filtered by session date or all)
    const assignedContent = await prisma.patientContent.findMany({
      where: { patientId: session.patientId },
      include: {
        content: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5, // Limit to recent 5 for recommendation
    });

    const recommendedContent = assignedContent.map(ac => ({
      ...ac.content,
      isViewed: !!ac.viewedAt,
      viewedAt: ac.viewedAt,
    }));

    res.json({
      session: {
        ...session,
        assignedProducts,
        recommendedContent,
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Create session or session package (ADMIN cannot create - only SUPPORT and BASIC operators can)
router.post(
  '/',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  [
    body('patientId').notEmpty(),
    body('date').optional().isISO8601(),
    body('dates').optional().isArray(),
    body('count').optional().isInt({ min: 1, max: 50 }),
    body('status').optional().isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
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

      const { patientId, date, dates, count, status, patientNotes, technicalNotes, instructions } = req.body;
      
      // Null check for required field
      if (!patientId) {
        return res.status(400).json({ error: 'patientId is required' });
      }

      // Check access: requires canEdit to create sessions
      if (req.user.role !== 'ADMIN') {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canEdit) {
          return res.status(403).json({ error: 'Edit permission required to create sessions' });
        }
      }

      // Determine if creating single session or package
      const isPackage = count && count > 1;
      const packageId = isPackage ? `pkg_${Date.now()}_${Math.random().toString(36).substring(7)}` : null;
      
      // Determine session dates
      let sessionDates: Date[] = [];
      if (dates && Array.isArray(dates)) {
        if (dates.length === 0) {
          return res.status(400).json({ error: 'Dates array cannot be empty' });
        }
        // Use provided dates array
        sessionDates = dates.map(d => new Date(d));
        // Validate all dates are valid
        if (sessionDates.some(d => isNaN(d.getTime()))) {
          return res.status(400).json({ error: 'Invalid date format in dates array' });
        }
        // Validate all dates are in the future
        const now = new Date();
        if (sessionDates.some(d => d < now)) {
          return res.status(400).json({ error: 'All session dates must be in the future' });
        }
        // Validate count matches dates if provided
        if (count && dates.length !== count) {
          return res.status(400).json({ error: 'Count does not match dates array length' });
        }
        // Validate maximum package count (50 sessions)
        if (sessionDates.length > 50) {
          return res.status(400).json({ error: 'Maximum package size is 50 sessions' });
        }
      } else if (isPackage && date) {
        // Generate dates starting from given date, weekly intervals
        const startDate = new Date(date);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({ error: 'Invalid date format' });
        }
        for (let i = 0; i < count; i++) {
          const sessionDate = new Date(startDate);
          sessionDate.setDate(startDate.getDate() + (i * 7)); // Weekly intervals
          sessionDates.push(sessionDate);
        }
      } else if (date) {
        // Single session
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'Invalid date format' });
        }
        sessionDates = [parsedDate];
      } else {
        return res.status(400).json({ error: 'date, dates, or count is required' });
      }

      // CRITICAL FIX: Create sessions in transaction for atomicity
      // If one session fails, all should roll back to avoid partial packages
      const operatorId = req.user.id;
      const sessions = await prisma.$transaction(async (tx) => {
        const createdSessions: any[] = [];
        
        for (let i = 0; i < sessionDates.length; i++) {
          const session = await tx.session.create({
            data: {
              patientId,
              operatorId,
              date: sessionDates[i],
              status: status || 'SCHEDULED',
              patientNotes,
              technicalNotes,
              photos: [],
              reminderSentAt: null,
              preparationChecklist: Prisma.JsonNull,
              feedbackSubmitted: false,
              beforePhoto: null,
              afterPhoto: null,
              packageId,
              sessionNumber: isPackage ? i + 1 : null,
              totalSessions: isPackage ? sessionDates.length : null,
              completeRequestedBy: null,
              completeRequestedAt: null,
              completeAcceptedBy: null,
              completeAcceptedAt: null,
              deleteRequestedBy: null,
              deleteRequestedAt: null,
              deleteAcceptedBy: null,
              deleteAcceptedAt: null,
            },
          });

          // Add instructions for this session within transaction
          if (instructions && Array.isArray(instructions)) {
            for (const inst of instructions) {
              if (inst.professionalType && inst.instruction) {
                await tx.sessionInstruction.create({
                  data: {
                    sessionId: session.id,
                    professionalType: inst.professionalType,
                    instruction: inst.instruction,
                    updatedAt: new Date(),
                  },
                });
              }
            }
          }

          createdSessions.push(session);
        }

        return createdSessions;
      });

      const mainSession = sessions[0];

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.CREATE,
        resourceType: isPackage ? 'SessionPackage' : 'Session',
        resourceId: packageId || mainSession.id,
        details: { sessionCount: sessions.length, packageId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Send notification to patient
      const operatorName = `${req.user.firstName} ${req.user.lastName}`;
      const dateStr = sessionDates[0].toLocaleDateString();
      await sendNotification({
        userId: patientId,
        title: isPackage ? 'New Session Package' : 'New Session Scheduled',
        message: isPackage 
          ? `${operatorName} scheduled ${sessions.length} sessions for you`
          : `${operatorName} scheduled a session for ${dateStr}`,
        type: NotificationType.SESSION_CREATED,
        data: {
          sessionId: mainSession.id,
          packageId,
          sessionCount: sessions.length,
          isPackage,
        },
      });

      res.status(201).json({ 
        sessions,
        package: isPackage ? { id: packageId, sessionCount: sessions.length } : null,
        message: isPackage ? `Created ${sessions.length} sessions in package` : 'Session created'
      });
    } catch (error) {
      console.error('Create session error:', error);
      res.status(500).json({ error: 'Failed to create session' });
    }
  }
);

// Update session (ADMIN cannot update - only SUPPORT and BASIC operators can)
router.put(
  '/:sessionId',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  [
    body('date').optional().isISO8601(), 
    body('status').optional().isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
    body('operatorId').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { date: newDate, status: newSessionStatus, patientNotes, technicalNotes, operatorId } = req.body;
      
      // Validate date if provided
      if (newDate !== undefined && newDate !== null && newDate !== '') {
        const parsedDate = new Date(newDate);
        if (isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'Invalid date format' });
        }
      }

      // Get session to find patient ID for permission check
      const existingSession = await sessionRepository.findById(sessionId);
      if (!existingSession) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Validate status transitions
      if (newSessionStatus && existingSession.status !== newSessionStatus) {
        const validTransitions: Record<string, string[]> = {
          'SCHEDULED': ['COMPLETED', 'CANCELLED'],
          'COMPLETED': [], // Cannot transition from completed
          'CANCELLED': [], // Cannot transition from cancelled
        };

        const currentStatus = existingSession.status;
        const allowedNextStatuses = validTransitions[currentStatus] || [];

        if (!allowedNextStatuses.includes(newSessionStatus)) {
          return res.status(400).json({ 
            error: `Invalid status transition from ${currentStatus} to ${newSessionStatus}`,
            allowedTransitions: allowedNextStatuses,
          });
        }
        
        // Prevent COMPLETED→SCHEDULED transition
        if (currentStatus === 'COMPLETED' && newSessionStatus === 'SCHEDULED') {
          return res.status(400).json({ 
            error: 'Cannot change status from COMPLETED to SCHEDULED',
          });
        }
      }
      
      // Check edit permission
      if (req.user?.role !== 'ADMIN') {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: existingSession.patientId,
              operatorId: req.user!.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canEdit) {
          return res.status(403).json({ error: 'Edit permission required' });
        }
      }

      // If reassigning operator, verify the new operator has access
      if (operatorId && operatorId !== existingSession.operatorId) {
        const newOperator = await prisma.user.findUnique({
          where: { id: operatorId },
          select: { id: true, isActive: true, userType: true },
        });

        if (!newOperator || newOperator.userType !== 'OPERATOR' || !newOperator.isActive) {
          return res.status(403).json({ error: 'New operator is not active or does not exist' });
        }

        const newOperatorAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: existingSession.patientId,
              operatorId,
            },
          },
        });

        if (!newOperatorAccess || !newOperatorAccess.canEdit) {
          return res.status(403).json({ error: 'New operator does not have edit access to this patient' });
        }
      }

      // Validate newDate is not in the past if provided
      if (newDate) {
        const parsedNewDate = new Date(newDate);
        const now = new Date();
        if (parsedNewDate < now) {
          return res.status(400).json({ error: 'Session date cannot be in the past' });
        }
      }

      const session = await sessionRepository.update(sessionId, {
        ...(newDate && { date: new Date(newDate) }),
        ...(newSessionStatus && { status: newSessionStatus }),
        ...(patientNotes !== undefined && { patientNotes }),
        ...(technicalNotes !== undefined && { technicalNotes }),
        ...(operatorId && { operatorId }),
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.UPDATE,
          resourceType: 'Session',
          resourceId: sessionId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.json({ session });
    } catch (error) {
      console.error('Update session error:', error);
      res.status(500).json({ error: 'Failed to update session' });
    }
  }
);

// Add instruction to session (ADMIN cannot add - only SUPPORT/BASIC operators can)
router.post(
  '/:sessionId/instructions',
  authenticateToken,
  requireRole('SUPPORT', 'BASIC'),
  [body('professionalType').notEmpty(), body('instruction').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { sessionId } = req.params;
      const { professionalType, instruction } = req.body;

      // Get session to verify access and for notification
      const session = await sessionRepository.findById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Check access
      if (req.user && req.user.userType === 'OPERATOR') {
        if (req.user.role !== 'ADMIN') {
          const hasAccess = await prisma.patientAccess.findUnique({
            where: {
              patientId_operatorId: {
                patientId: session.patientId,
                operatorId: req.user.id,
              },
            },
          });

          if (!hasAccess || !hasAccess.canEdit) {
            return res.status(403).json({ error: 'Edit permission required' });
          }
        }
      }

      const instructionRecord = await sessionRepository.addInstruction(sessionId, {
        professionalType,
        instruction,
        updatedAt: new Date(),
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.CREATE,
          resourceType: 'SessionInstruction',
          resourceId: instructionRecord.id,
          details: { sessionId },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      // Send notification to patient
      if (req.user && req.user.firstName && req.user.lastName) {
        const operatorName = `${req.user.firstName} ${req.user.lastName}`;
        await sendNotification({
          userId: session.patientId,
          title: 'New Instruction',
          message: `${operatorName} added ${professionalType} instructions to your session`,
          type: NotificationType.SESSION_INSTRUCTION_ADDED,
          data: { sessionId, instructionId: instructionRecord.id, professionalType },
        });
      }

      res.status(201).json({ instruction: instructionRecord });
    } catch (error) {
      console.error('Add instruction error:', error);
      res.status(500).json({ error: 'Failed to add instruction' });
    }
  }
);

// Request session completion (Requires both patient and operator agreement)
router.post('/:sessionId/request-complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const session = await sessionRepository.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if user has access to this session
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operator must have access to this patient or be the assigned operator
      if (req.user.role !== 'ADMIN' && session.operatorId !== req.user.id) {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canView) {
          return res.status(403).json({ error: 'Access denied. You do not have permission for this patient.' });
        }
      }
    }

    // Mark request from current user
    const updatedSession = await prisma.session.update({
      where: { id: sessionId },
      data: {
        completeRequestedBy: req.user.id,
        completeRequestedAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Send notification to the other party
    if (req.user) {
      const requesterName = `${req.user.firstName} ${req.user.lastName}`;
      const recipientId = req.user.userType === 'PATIENT' ? updatedSession.operatorId : updatedSession.patientId;
    
      await sendNotification({
        userId: recipientId,
        title: 'Session Completion Request',
        message: `${requesterName} requested to mark this session as completed`,
        type: NotificationType.SESSION_COMPLETE_REQUEST,
        data: { sessionId },
      });
    }

    res.json({ 
      session: updatedSession, 
      message: 'Completion request sent. Waiting for approval from the other party.' 
    });
  } catch (error) {
    console.error('Request complete error:', error);
    res.status(500).json({ error: 'Failed to request completion' });
  }
});

// Accept completion request
router.post('/:sessionId/accept-complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const session = await sessionRepository.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.completeRequestedBy) {
      return res.status(400).json({ error: 'No completion request to accept' });
    }

    // Check if session is already COMPLETED
    if (session.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Session is already completed' });
    }

    // Check if user is the one who should accept
    if (session.completeRequestedBy === req.user.id) {
      return res.status(400).json({ error: 'You cannot accept your own request' });
    }

    // Check access - verify user is part of this session
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operator must have access to this patient or be the assigned operator
      if (req.user.role !== 'ADMIN' && session.operatorId !== req.user.id) {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canView) {
          return res.status(403).json({ error: 'Access denied. You do not have permission for this patient.' });
        }
      }
    }

    // Mark session as completed
    const updatedSession = await sessionRepository.update(sessionId, {
      status: 'COMPLETED',
      completeAcceptedBy: req.user.id,
      completeAcceptedAt: new Date(),
    });

    res.json({ session: updatedSession, message: 'Session marked as completed' });
  } catch (error) {
    console.error('Accept complete error:', error);
    res.status(500).json({ error: 'Failed to accept completion' });
  }
});

// Request session deletion (Requires both patient and operator agreement)
router.post('/:sessionId/request-delete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const session = await sessionRepository.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if user has access to this session
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operator must have access to this patient or be the assigned operator
      if (req.user.role !== 'ADMIN' && session.operatorId !== req.user.id) {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canView) {
          return res.status(403).json({ error: 'Access denied. You do not have permission for this patient.' });
        }
      }
    }

    // Mark delete request from current user
    const updatedSession = await prisma.session.update({
      where: { id: sessionId },
      data: {
        deleteRequestedBy: req.user.id,
        deleteRequestedAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Send notification to the other party
    if (req.user) {
      const requesterName = `${req.user.firstName} ${req.user.lastName}`;
      const recipientId = req.user.userType === 'PATIENT' ? updatedSession.operatorId : updatedSession.patientId;
    
      await sendNotification({
        userId: recipientId,
        title: 'Session Delete Request',
        message: `${requesterName} requested to delete this session`,
        type: NotificationType.SESSION_DELETE_REQUEST,
        data: { sessionId },
      });
    }

    res.json({ 
      session: updatedSession, 
      message: 'Delete request sent. Waiting for approval from the other party.' 
    });
  } catch (error) {
    console.error('Request delete error:', error);
    res.status(500).json({ error: 'Failed to request deletion' });
  }
});

// Accept deletion request
router.post('/:sessionId/accept-delete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const session = await sessionRepository.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.deleteRequestedBy) {
      return res.status(400).json({ error: 'No delete request to accept' });
    }

    // Check if user is the one who should accept
    if (session.deleteRequestedBy === req.user.id) {
      return res.status(400).json({ error: 'You cannot accept your own request' });
    }

    // Check access - verify user is part of this session
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operator must have access to this patient or be the assigned operator
      if (req.user.role !== 'ADMIN' && session.operatorId !== req.user.id) {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canView) {
          return res.status(403).json({ error: 'Access denied. You do not have permission for this patient.' });
        }
      }
    }

    // Mark session as accepted for deletion before deleting
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        deleteAcceptedBy: req.user.id,
        deleteAcceptedAt: new Date(),
      },
    });

    // Delete the session
    await sessionRepository.delete(sessionId);

    // Send notification to requester
    if (req.user && session.deleteRequestedBy) {
      const accepterName = `${req.user.firstName} ${req.user.lastName}`;
      await sendNotification({
        userId: session.deleteRequestedBy,
        title: 'Session Deleted',
        message: `${accepterName} accepted. Session has been deleted`,
        type: NotificationType.SESSION_DELETED,
        data: { sessionId },
      });
    }

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Accept delete error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Compare two sessions (before/after)
router.get('/compare/:sessionId1/:sessionId2', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId1, sessionId2 } = req.params;

    const [session1, session2] = await Promise.all([
      sessionRepository.findById(sessionId1),
      sessionRepository.findById(sessionId2),
    ]);

    if (!session1 || !session2) {
      return res.status(404).json({ error: 'One or both sessions not found' });
    }

    // Check access - both sessions must be for the same patient or user must have access
    if (req.user?.userType === 'PATIENT') {
      if (session1.patientId !== req.user.id || session2.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user?.role !== 'ADMIN') {
      // For operators, check if they have access to the patient
      const hasAccess1 = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session1.patientId,
            operatorId: req.user!.id,
          },
        },
      });
      const hasAccess2 = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session2.patientId,
            operatorId: req.user!.id,
          },
        },
      });

      if (!hasAccess1 || !hasAccess2) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Validate session dates before comparison
    const date1 = new Date(session1.date);
    const date2 = new Date(session2.date);
    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
      return res.status(400).json({ error: 'Invalid session date format' });
    }
    
    const comparison = {
      before: session1,
      after: session2,
      comparison: {
        daysBetween: Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)),
        statusChange: session1.status !== session2.status,
      },
    };

    // Log audit
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.VIEW,
        resourceType: 'SessionComparison',
        resourceId: `${sessionId1}-${sessionId2}`,
        details: { sessionId1, sessionId2, daysBetween: comparison.comparison.daysBetween },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    res.json(comparison);
  } catch (error) {
    console.error('Compare sessions error:', error);
    res.status(500).json({ error: 'Failed to compare sessions' });
  }
});

// Delete session file
router.delete('/:sessionId/files/:fileId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId, fileId } = req.params;

    // Get session to check access
    const session = await sessionRepository.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access
    if (req.user.userType === 'PATIENT') {
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session.patientId,
            operatorId: req.user.id,
          },
        },
      });
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get file to delete
    const file = await prisma.sessionFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.sessionId !== sessionId) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete file from filesystem with path traversal protection
    const fs = require('fs');
    const path = require('path');
    const { safeResolveFilePath } = require('../utils/fileUtils');
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    
    if (file.filePath) {
      const filePath = safeResolveFilePath(uploadsDir, file.filePath);
      if (filePath) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fsError) {
          console.error('Failed to delete file from filesystem:', fsError);
          // Continue with DB deletion even if file deletion fails
        }
      } else {
        console.warn('⚠️ Skipped unsafe file path:', file.filePath);
      }
    }

    // Delete from database
    await prisma.sessionFile.delete({
      where: { id: fileId },
    });

    // Log audit
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.DELETE,
        resourceType: 'SessionFile',
        resourceId: fileId,
        details: { sessionId, fileName: file.fileName },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete session file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Submit session feedback (patient only)
router.post('/:sessionId/feedback', authenticateToken, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comments').optional().isString(),
], async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Only patients can submit feedback' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { sessionId } = req.params;
    const { rating, comments } = req.body;
    const patientId = req.user.id;

    // Get session and verify ownership
    const session = await sessionRepository.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.patientId !== patientId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create or update feedback
    const feedback = await prisma.sessionFeedback.upsert({
      where: { sessionId },
      update: {
        rating,
        comments: comments || null,
        submittedAt: new Date(),
      },
      create: {
        sessionId,
        rating,
        comments: comments || null,
      },
    });

    // Update session feedback flag
    await prisma.session.update({
      where: { id: sessionId },
      data: { feedbackSubmitted: true },
    });

    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.CREATE,
      resourceType: 'SessionFeedback',
      resourceId: feedback.id,
      details: { sessionId, rating },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.status(201).json({ feedback });
  } catch (error) {
    console.error('Submit session feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get session feedback
router.get('/:sessionId/feedback', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;

    // Get session to check access
    const session = await sessionRepository.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access
    if (req.user.userType === 'PATIENT' && session.patientId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.userType === 'OPERATOR' && req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session.patientId,
            operatorId: req.user.id,
          },
        },
      });
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const feedback = await prisma.sessionFeedback.findUnique({
      where: { sessionId },
    });

    res.json({ feedback: feedback || null });
  } catch (error) {
    console.error('Get session feedback error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Upload before/after photo (can be done anytime during treatment)
router.post('/:sessionId/before-after-photo', authenticateToken, [
  body('photoType').isIn(['BEFORE', 'AFTER']),
  body('filePath').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { sessionId } = req.params;
    const { photoType, filePath } = req.body;
    
    // Get session
    const existingSession = await sessionRepository.findById(sessionId);
    if (!existingSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check permissions: patient owns session OR operator has edit access
    if (req.user.userType === 'PATIENT') {
      if (existingSession.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.userType === 'OPERATOR' && req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: existingSession.patientId,
            operatorId: req.user.id,
          },
        },
      });
      if (!hasAccess || !hasAccess.canEdit) {
        return res.status(403).json({ error: 'Edit permission required' });
      }
    }

    // Update session with photo
    const updateData: any = {};
    if (photoType === 'BEFORE') {
      updateData.beforePhoto = filePath;
    } else {
      updateData.afterPhoto = filePath;
    }

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
    });
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.FILE_UPLOADED,
      resourceType: 'Session',
      resourceId: sessionId,
      details: { photoType, filePath },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ session, message: `${photoType} photo uploaded successfully` });
  } catch (error) {
    console.error('Upload before/after photo error:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Delete session (simplified - only requires edit permission)
router.delete('/:sessionId', authenticateToken, requireRole('SUPPORT', 'BASIC'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    
    // Get session to check permissions
    const existingSession = await sessionRepository.findById(sessionId);
    if (!existingSession) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check edit permission
    if (req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: existingSession.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canEdit) {
        return res.status(403).json({ error: 'Edit permission required to delete session' });
      }
    }

    // Delete the session
    await sessionRepository.delete(sessionId);
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'Session',
      resourceId: sessionId,
      details: { patientId: existingSession.patientId },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ==================== SESSION QUESTIONS ====================

// Get questions for a session
router.get('/:sessionId/questions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    
    // Check session access
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { patientId: true, operatorId: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if user has access to this session
    const hasAccess = req.user.userType === 'PATIENT' 
      ? session.patientId === req.user.id
      : req.user.role === 'ADMIN' || await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const questions = await prisma.sessionQuestion.findMany({
      where: { sessionId },
      include: {
        asker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userType: true,
          },
        },
        answerer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userType: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ questions });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Failed to get questions' });
  }
});

// Add a question to a session (patients only)
router.post('/:sessionId/questions', authenticateToken, [
  body('question').notEmpty().trim(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const { question } = req.body;

    // Check session exists and user has access
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { patientId: true, status: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only patients can add questions to their own sessions
    if (req.user.userType !== 'PATIENT' || session.patientId !== req.user.id) {
      return res.status(403).json({ error: 'Only patients can add questions to their sessions' });
    }

    // Create question
    const newQuestion = await prisma.sessionQuestion.create({
      data: {
        sessionId,
        question,
        askedBy: req.user.id,
      },
      include: {
        asker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userType: true,
          },
        },
      },
    });

    // Get session operator to notify them
    const fullSession = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { operatorId: true, patientId: true },
    });

    // Get patient name for notification
    const patient = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { firstName: true, lastName: true },
    });

    // Send notification to operator
    if (fullSession?.operatorId && patient) {
      await sendNotification({
        userId: fullSession.operatorId,
        title: 'New Question',
        message: `${patient.firstName} ${patient.lastName} asked a question`,
        type: NotificationType.SESSION_QUESTION_ASKED,
        data: { sessionId, questionId: newQuestion.id },
      });
    }

    // Emit session event to patient room
    emitSessionEvent('QUESTION_ASKED', sessionId, session.patientId, { question: newQuestion });

    res.status(201).json({ question: newQuestion });
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// Reassign session to different operator (ADMIN or session owner only)
router.put('/:sessionId/reassign', authenticateToken, requireRole('ADMIN', 'SUPPORT', 'BASIC'), [
  body('newOperatorId').notEmpty(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const { newOperatorId } = req.body;

    // Get session
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { patientId: true, operatorId: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check permissions: Only ADMIN or current operator can reassign
    if (req.user.role !== 'ADMIN' && session.operatorId !== req.user.id) {
      return res.status(403).json({ error: 'Only session owner or admin can reassign' });
    }

    // Verify new operator has access to patient
    const newOperatorAccess = await prisma.patientAccess.findUnique({
      where: {
        patientId_operatorId: {
          patientId: session.patientId,
          operatorId: newOperatorId,
        },
      },
    });

    if (!newOperatorAccess || !newOperatorAccess.canEdit) {
      return res.status(403).json({ error: 'New operator does not have edit access to this patient' });
    }

    // Update session
    const updatedSession = await prisma.session.update({
      where: { id: sessionId },
      data: { operatorId: newOperatorId },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    res.json({ session: updatedSession });
  } catch (error) {
    console.error('Reassign session error:', error);
    res.status(500).json({ error: 'Failed to reassign session' });
  }
});

// Answer a question (operators only)
router.put('/:sessionId/questions/:questionId/answer', authenticateToken, requireRole('SUPPORT', 'BASIC'), [
  body('answer').notEmpty().trim(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId, questionId } = req.params;
    const { answer } = req.body;

    // Check session exists and operator has access
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { patientId: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check operator access
    if (req.user.role !== 'ADMIN') {
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId: session.patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Update question with answer
    const updatedQuestion = await prisma.sessionQuestion.update({
      where: { id: questionId },
      data: {
        answer,
        answeredBy: req.user.id,
        answeredAt: new Date(),
      },
      include: {
        asker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userType: true,
          },
        },
        answerer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userType: true,
          },
        },
      },
    });

    // Get operator name for notification
    const operator = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { firstName: true, lastName: true },
    });

    // Send notification to patient (question asker)
    if (operator) {
      await sendNotification({
        userId: session.patientId,
        title: 'Question Answered',
        message: `Dr. ${operator.firstName} ${operator.lastName} answered your question`,
        type: NotificationType.SESSION_QUESTION_ANSWERED,
        data: { sessionId, questionId },
      });
    }

    // Emit session event to patient room
    emitSessionEvent('QUESTION_ANSWERED', sessionId, session.patientId, { question: updatedQuestion });

    res.json({ question: updatedQuestion });
  } catch (error) {
    console.error('Answer question error:', error);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});

export default router;




