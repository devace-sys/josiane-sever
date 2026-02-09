import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { sendNotification, NotificationType } from '../utils/notificationHelper';

const router = Router();
const prisma = new PrismaClient();

// Get all groups for current user
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userId = req.user.id;

    const groups = await prisma.groupChat.findMany({
      where: {
        isActive: true,
        members: {
          some: {
            userId,
            leftAt: null,
          },
        },
      },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profileImage: true,
                isOnline: true,
                lastSeenAt: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // CRITICAL FIX: Get unread counts efficiently with a single query
    if (!Array.isArray(groups)) {
      return res.status(500).json({ error: 'Invalid groups data' });
    }
    const groupIds = groups.map(g => g.id);
    
    const unreadCounts = await prisma.message.groupBy({
      by: ['groupId'],
      where: {
        groupId: { in: groupIds },
        senderId: { not: userId },
        readReceipts: {
          none: { userId },
        },
      },
      _count: {
        id: true,
      },
    });

    if (!Array.isArray(unreadCounts)) {
      return res.status(500).json({ error: 'Invalid unread counts data' });
    }
    const unreadMap = new Map(unreadCounts.map(item => [item.groupId, item._count.id]));

    const groupsWithUnread = groups.map((group) => ({
      ...group,
      unreadCount: unreadMap.get(group.id) || 0,
      lastMessage: group.messages[0] || null,
    }));

    res.json(groupsWithUnread);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get single group
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is member
    const membership = await prisma.groupMember.findFirst({
      where: {
        groupId: id,
        userId,
        leftAt: null,
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const group = await prisma.groupChat.findUnique({
      where: { id },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profileImage: true,
                isOnline: true,
                lastSeenAt: true,
                userType: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Create group
router.post(
  '/',
  authenticateToken,
  [
    body('name').notEmpty().trim(),
    body('description').optional().trim(),
    body('memberIds').isArray().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, memberIds } = req.body;
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const userId = req.user.id;

      // Validate memberIds is an array
      if (!Array.isArray(memberIds) || memberIds.length === 0) {
        return res.status(400).json({ error: 'memberIds must be a non-empty array' });
      }

      // Create group with creator as admin
      const group = await prisma.groupChat.create({
        data: {
          name,
          description,
          createdBy: userId,
          members: {
            create: [
              { userId, role: 'ADMIN' as const },
              ...memberIds.map((id: string) => ({ userId: id, role: 'MEMBER' as const })),
            ],
          },
        },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profileImage: true,
                },
              },
            },
          },
        },
      });

      // Notify all members
      if (Array.isArray(memberIds)) {
        for (const memberId of memberIds) {
          await sendNotification({
            userId: memberId,
            title: 'Added to Group',
            message: `You were added to ${name}`,
            type: 'GROUP_ADDED',
            data: { groupId: group.id },
          });
        }
      }

      res.status(201).json(group);
    } catch (error) {
      console.error('Create group error:', error);
      res.status(500).json({ error: 'Failed to create group' });
    }
  }
);

// Add member to group
router.post(
  '/:id/members',
  authenticateToken,
  [body('userId').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { userId: newMemberId } = req.body;
      const userId = req.user!.id;

      // Check if requester is admin or moderator
      const membership = await prisma.groupMember.findFirst({
        where: {
          groupId: id,
          userId,
          leftAt: null,
          role: { in: ['ADMIN', 'MODERATOR'] },
        },
      });

      if (!membership) {
        return res.status(403).json({ error: 'Only admins can add members' });
      }

      // Add member
      const newMember = await prisma.groupMember.create({
        data: {
          groupId: id,
          userId: newMemberId,
          role: 'MEMBER',
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profileImage: true,
            },
          },
          group: true,
        },
      });

      // Notify new member
      await sendNotification({
        userId: newMemberId,
        title: 'Added to Group',
        message: `You were added to ${newMember.group.name}`,
        type: 'GROUP_ADDED',
        data: { groupId: id },
      });

      res.json(newMember);
    } catch (error) {
      console.error('Add member error:', error);
      res.status(500).json({ error: 'Failed to add member' });
    }
  }
);

// Leave group
router.post('/:id/leave', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.groupMember.updateMany({
      where: {
        groupId: id,
        userId,
        leftAt: null,
      },
      data: {
        leftAt: new Date(),
      },
    });

    res.json({ message: 'Left group successfully' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// Get group messages
router.get('/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    // Check membership
    const membership = await prisma.groupMember.findFirst({
      where: {
        groupId: id,
        userId,
        leftAt: null,
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const messages = await prisma.message.findMany({
      where: { groupId: id },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        attachments: true,
        readReceipts: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    res.json(messages.reverse());
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send group message
router.post(
  '/:id/messages',
  authenticateToken,
  [body('content').optional(), body('replyToId').optional(), body('attachments').optional()],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { content, replyToId, attachments } = req.body;
      const userId = req.user!.id;

      // Check membership
      const membership = await prisma.groupMember.findFirst({
        where: {
          groupId: id,
          userId,
          leftAt: null,
        },
      });

      if (!membership) {
        return res.status(403).json({ error: 'Not a member of this group' });
      }

      const hasContent = content && String(content).trim();
      const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
      if (!hasContent && !hasAttachments) {
        return res.status(400).json({ error: 'Content or attachments are required' });
      }

      const contentStr = hasContent ? String(content).trim() : '';

      // Extract mentions
      const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(contentStr)) !== null) {
        mentions.push(match[2]); // User ID
      }

      const message = await prisma.message.create({
        data: {
          groupId: id,
          senderId: userId,
          content: contentStr,
          mentions,
          replyToId: replyToId || null,
          attachments: hasAttachments
            ? {
                create: attachments.map((att: { filePath: string; fileName: string; fileSize?: number; mimeType?: string }) => ({
                  filePath: att.filePath,
                  fileName: att.fileName,
                  fileSize: att.fileSize ?? null,
                  mimeType: att.mimeType ?? null,
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
              profileImage: true,
              userType: true,
              role: true,
            },
          },
          replyTo: {
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          attachments: true,
        },
      });

      // Update group timestamp
      await prisma.groupChat.update({
        where: { id },
        data: { updatedAt: new Date() },
      });

      // Broadcast new message to group room for real-time updates
      io.to(`group-${id}`).emit('new-message', message);

      // Mention notifications: send to each mentioned user (except sender)
      if (mentions.length > 0 && message.sender) {
        const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
        const messagePreview = contentStr.substring(0, 100) + (contentStr.length > 100 ? '...' : '');
        for (const mentionedUserId of mentions) {
          if (mentionedUserId === userId) continue;
          try {
            io.to(`user-${mentionedUserId}`).emit('mention-notification', {
              type: 'GROUP_MENTION',
              groupId: id,
              messageId: message.id,
              senderName,
              content: messagePreview,
              timestamp: new Date(),
            });
            await sendNotification({
              userId: mentionedUserId,
              title: `${senderName} mentioned you`,
              message: messagePreview,
              type: NotificationType.MENTION,
              data: { groupId: id, messageId: message.id, senderId: userId },
            });
          } catch (notifErr) {
            console.error('Group mention notification error:', notifErr);
          }
        }
      }

      res.status(201).json(message);
    } catch (error) {
      console.error('Send group message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Mark all messages in group as read for current user
router.post('/:groupId/read-all', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { groupId } = req.params;
    const userId = req.user.id;
    const membership = await prisma.groupMember.findFirst({
      where: { groupId, userId, leftAt: null },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member of this group' });
    const messages = await prisma.message.findMany({
      where: { groupId },
      select: { id: true },
    });
    for (const msg of messages) {
      await prisma.messageReadReceipt.upsert({
        where: { messageId_userId: { messageId: msg.id, userId } },
        create: { messageId: msg.id, userId },
        update: { readAt: new Date() },
      });
    }
    res.json({ message: 'All messages marked as read' });
  } catch (error) {
    console.error('Mark group read-all error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Mark message as read
router.post('/:groupId/messages/:messageId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { groupId, messageId } = req.params;
    const userId = req.user.id;

    // Check membership
    const membership = await prisma.groupMember.findFirst({
      where: {
        groupId,
        userId,
        leftAt: null,
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    await prisma.messageReadReceipt.upsert({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
      create: {
        messageId,
        userId,
      },
      update: {
        readAt: new Date(),
      },
    });

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

export default router;
