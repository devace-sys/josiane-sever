import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { checkPatientAccess } from '../middleware/patientAccess';
import { io } from '../index';
import { sendNotification, NotificationType } from '../utils/notificationHelper';
import { auditLogger } from '../utils/auditLogger';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Initialize DOMPurify for server-side sanitization
const window = new JSDOM('').window;
const purify = DOMPurify(window as any);

const router = express.Router();
const prisma = new PrismaClient();

// Get operators/doctors for a patient (for contact list)
router.get('/patient/:patientId/operators', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    
    const accesses = await prisma.patientAccess.findMany({
      where: {
        patientId,
        canView: true,
      },
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            profileImage: true,
          },
        },
      },
    });

    const operators = accesses
      .map(access => access.operator)
      .filter(op => op !== null && op.role !== 'ADMIN'); // Exclude admins

    res.json({ operators });
  } catch (error) {
    console.error('Get operators error:', error);
    res.status(500).json({ error: 'Failed to fetch operators' });
  }
});

// Get messages for patient (scoped to 1:1 thread when operator or otherParticipantId provided)
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const otherParticipantId = req.query.otherParticipantId as string | undefined;

    // 1:1 thread: only show messages in this conversation (patient + one operator)
    const threadOperatorId =
      req.user!.userType === 'OPERATOR'
        ? req.user!.id
        : otherParticipantId || undefined;

    const where: { patientId: string; groupId?: null; OR?: Array<{ operatorId: null } | { operatorId: string }> } = {
      patientId,
      groupId: null,
    };
    if (threadOperatorId) {
      where.OR = [{ operatorId: null }, { operatorId: threadOperatorId }];
    }

    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            userType: true,
            role: true,
            profileImage: true,
          },
        },
        attachments: {
          select: {
            id: true,
            messageId: true,
            filePath: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });

    // Log audit for message viewing
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.VIEW,
        resourceType: 'Message',
        resourceId: patientId,
        details: { messageCount: messages.length },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch messages: ${errorMessage}` });
  }
});

// Send message
router.post(
  '/',
  authenticateToken,
  [body('patientId').notEmpty(), body('content').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { patientId, content: rawContent, mentions: providedMentions, attachments, operatorId: bodyOperatorId } = req.body;

      // SECURITY: Sanitize message content to prevent XSS attacks
      const content = purify.sanitize(rawContent, {
        ALLOWED_TAGS: [], // Strip all HTML tags
        ALLOWED_ATTR: [], // Strip all attributes
        KEEP_CONTENT: true, // Keep text content
      });

      // Auto-detect @ mentions in content (e.g., @John, @Dr.Smith)
      const mentionRegex = /@(\w+)/g;
      const detectedMentions: string[] = [];
      let match;
      
      // FIX N+1 QUERY: Fetch all operators with access to this patient first
      const accesses = await prisma.patientAccess.findMany({
        where: {
          patientId,
          canView: true,
        },
        include: {
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      });
      
      // Build a map for quick lookup
      const operatorMap = new Map<string, { id: string; firstName: string; lastName: string; role: string }>();
      accesses.forEach(access => {
        const op = access.operator;
        if (op.role && op.role !== 'ADMIN') {
          operatorMap.set(op.id, {
            id: op.id,
            firstName: op.firstName,
            lastName: op.lastName,
            role: op.role,
          });
        }
      });
      
      while ((match = mentionRegex.exec(content)) !== null) {
        const mentionedName = match[1].toLowerCase();
        
        // Match by first name or last name (case insensitive) - now using in-memory map
        for (const [opId, op] of operatorMap.entries()) {
          if (op.firstName.toLowerCase().includes(mentionedName) ||
              op.lastName.toLowerCase().includes(mentionedName)) {
            if (!detectedMentions.includes(opId)) {
              detectedMentions.push(opId);
            }
          }
        }
      }

      // Merge detected mentions with provided mentions (if any)
      const allMentions = [...new Set([...(providedMentions || []), ...detectedMentions])];

      // Check access - ADMIN cannot chat with patients
      if (req.user.userType === 'PATIENT') {
        if (req.user.id !== patientId) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else {
        // ADMIN cannot send messages to patients
        if (req.user.role === 'ADMIN') {
          return res.status(403).json({ error: 'Admin cannot chat with patients' });
        }
        // Operators need patient access
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

      // Check if chat is enabled
      const config = await prisma.clinicConfig.findFirst();
      if (config && !config.featureChatEnabled) {
        return res.status(403).json({ error: 'Chat is disabled' });
      }

      // Verify patient exists and is a PATIENT user
      const patientUser = await prisma.user.findUnique({
        where: { id: patientId },
        select: { id: true, userType: true },
      });

      if (!patientUser || patientUser.userType !== 'PATIENT') {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // 1:1 thread: set operatorId so message belongs to one conversation
      const messageOperatorId =
        req.user!.userType === 'OPERATOR'
          ? req.user!.id
          : bodyOperatorId || null;
      if (req.user!.userType === 'PATIENT' && !messageOperatorId) {
        return res.status(400).json({ error: 'operatorId is required when patient sends a message (to identify the 1:1 thread)' });
      }

      // Create message using Prisma - ALL senders are Users now
      const message = await prisma.message.create({
        data: {
          patientId,
          operatorId: messageOperatorId,
          senderId: req.user.id, // Always references User.id
          content,
          mentions: allMentions,
          attachments: attachments
            ? {
                create: attachments.map((att: any) => ({
                  filePath: att.filePath,
                  fileName: att.fileName,
                  fileSize: att.fileSize,
                  mimeType: att.mimeType,
                })),
              }
            : undefined,
        },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              userType: true,
              role: true,
              profileImage: true,
            },
          },
          attachments: {
            select: {
              id: true,
              messageId: true,
              filePath: true,
              fileName: true,
              fileSize: true,
              mimeType: true,
              createdAt: true,
            },
          },
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.CREATE,
        resourceType: 'Message',
        resourceId: message.id,
        details: { patientId, hasMentions: allMentions.length > 0, hasAttachments: (attachments && attachments.length > 0) },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      // Emit real-time message AFTER successful DB commit
      io.to(`patient-${patientId}`).emit('new-message', message);

      // CRITICAL FIX: Update badge count for recipient
      // Validate sender exists before accessing sender.id
      if (!message.sender || !message.sender.id) {
        return res.status(500).json({ error: 'Invalid message sender data' });
      }
      const recipientId = message.senderId === patientId ? message.sender.id : patientId;
      if (!recipientId) {
        return res.status(400).json({ error: 'Invalid recipient ID' });
      }
      const unreadCount = await prisma.message.count({
        where: {
          patientId,
          senderId: { not: recipientId },
          isRead: false,
        },
      });
      io.to(`user-${recipientId}`).emit('badge-update', { type: 'message', count: unreadCount });

      // Send push notification to recipients (all patient room members except sender)
      const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
      const messagePreview = content.substring(0, 100) + (content.length > 100 ? '...' : '');
      
      // Get all users in the patient room (patient + assigned operators)
      const patientAccesses = await prisma.patientAccess.findMany({
        where: { patientId, canView: true },
        select: { operatorId: true },
      });
      
      const roomUserIds = [
        patientId,
        ...patientAccesses.map(a => a.operatorId),
      ].filter(id => id !== req.user?.id); // Exclude sender

      // Send notification to all recipients (include senderId so patient can open correct chat)
      if (req.user) {
        const senderId = req.user.id;
        for (const userId of roomUserIds) {
          await sendNotification({
            userId,
            title: `New message from ${senderName}`,
            message: messagePreview,
            type: NotificationType.NEW_MESSAGE,
            data: { messageId: message.id, patientId, senderId },
          });
        }
      }

      // Send mention notifications to mentioned users
      if (allMentions.length > 0) {
        const mentionNotification = {
          type: 'mention',
          messageId: message.id,
          patientId,
          senderName,
          content: messagePreview,
          timestamp: new Date(),
        };

        for (const userId of allMentions) {
          io.to(`user-${userId}`).emit('mention-notification', mentionNotification);
          
          // Also send push notification for mentions
          await sendNotification({
            userId,
            title: `${senderName} mentioned you`,
            message: messagePreview,
            type: NotificationType.MENTION,
            data: { messageId: message.id, patientId, senderId: req.user?.id },
          });
        }
      }

      res.status(201).json({ message });
    } catch (error) {
      console.error('Send message error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ error: `Failed to send message: ${errorMessage}` });
    }
  }
);

// Mark message as read
router.put('/:messageId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;
    
    const message = await prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });

    // CRITICAL FIX: Update badge count for user who marked as read
    if (message.patientId) {
      const unreadCount = await prisma.message.count({
        where: {
          patientId: message.patientId,
          senderId: { not: userId },
          isRead: false,
        },
      });
      io.to(`user-${userId}`).emit('badge-update', { type: 'message', count: unreadCount });
    }

    res.json({ message });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Mark all messages as read for patient (scoped to 1:1 thread when operator)
router.put('/patient/:patientId/read-all', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const userId = req.user!.id;
    const otherParticipantId = req.query.otherParticipantId as string | undefined;
    const threadOperatorId = req.user!.userType === 'OPERATOR' ? req.user!.id : otherParticipantId;

    const readWhere: { patientId: string; isRead: boolean; OR?: Array<{ operatorId: null } | { operatorId: string }> } = {
      patientId,
      isRead: false,
    };
    if (threadOperatorId) {
      readWhere.OR = [{ operatorId: null }, { operatorId: threadOperatorId }];
    }
    await prisma.message.updateMany({
      where: readWhere,
      data: { isRead: true },
    });

    // CRITICAL FIX: Update badge count to 0 (all read)
    io.to(`user-${userId}`).emit('badge-update', { type: 'message', count: 0 });

    res.json({ message: 'All messages marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Get unread count for patient (workflow format: GET /messages/unread-count?patientId=me)
router.get('/unread-count', authenticateToken, async (req: AuthRequest, res: Response) => {
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

    // For patients, they can only see their own unread count
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

    // Count unread messages scoped to 1:1 thread when otherParticipantId provided (patient) or for operator
    const otherParticipantId = req.query.otherParticipantId as string | undefined;
    const threadOperatorId = req.user.userType === 'OPERATOR' ? req.user.id : otherParticipantId;

    let unreadCount = 0;
    if (req.user.userType === 'PATIENT') {
      const wherePatient: any = {
        patientId,
        isRead: false,
        sender: { userType: 'OPERATOR' },
      };
      if (threadOperatorId) {
        wherePatient.OR = [{ operatorId: null }, { operatorId: threadOperatorId }];
      }
      unreadCount = await prisma.message.count({ where: wherePatient });
    } else {
      const whereOperator: any = {
        patientId,
        isRead: false,
        sender: { userType: 'PATIENT', id: patientId },
      };
      if (threadOperatorId) {
        whereOperator.OR = [{ operatorId: null }, { operatorId: threadOperatorId }];
      }
      unreadCount = await prisma.message.count({ where: whereOperator });
    }

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

export default router;


