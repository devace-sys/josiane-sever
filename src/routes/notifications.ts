import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
} from '../services/pushNotificationService';

const router = express.Router();
const prisma = new PrismaClient();

// Register device token for push notifications
router.post(
  '/register-token',
  authenticateToken,
  [
    body('token').notEmpty(),
    body('platform').isIn(['android', 'ios', 'web']),
    body('deviceId').optional().isString(),
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

      const { token, platform, deviceId } = req.body;
      await registerDeviceToken(req.user.id, token, platform, deviceId);

      res.json({ message: 'Device token registered successfully' });
    } catch (error) {
      console.error('Register device token error:', error);
      res.status(500).json({ error: 'Failed to register device token' });
    }
  }
);

// Unregister device token
router.post(
  '/unregister-token',
  authenticateToken,
  [body('token').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token } = req.body;
      await unregisterDeviceToken(token);

      res.json({ message: 'Device token unregistered successfully' });
    } catch (error) {
      console.error('Unregister device token error:', error);
      res.status(500).json({ error: 'Failed to unregister device token' });
    }
  }
);

// Get user notifications
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const limitParam = req.query.limit as string;
    const offsetParam = req.query.offset as string;
    
    let limit = 50;
    let offset = 0;
    
    if (limitParam !== undefined) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        return res.status(400).json({ error: 'limit must be a valid non-negative integer' });
      }
      limit = parsedLimit;
    }
    
    if (offsetParam !== undefined) {
      const parsedOffset = parseInt(offsetParam, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return res.status(400).json({ error: 'offset must be a valid non-negative integer' });
      }
      offset = parsedOffset;
    }

    const notifications = await getUserNotifications(req.user.id, limit, offset);
    const unreadCount = await getUnreadNotificationCount(req.user.id);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread count
router.get('/unread-count', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const count = await getUnreadNotificationCount(req.user.id);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { notificationId } = req.params;

    // Verify notification belongs to user
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await markNotificationAsRead(notificationId);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await markAllNotificationsAsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export default router;
