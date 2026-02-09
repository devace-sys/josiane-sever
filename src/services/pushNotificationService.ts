import * as admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();

// Initialize Firebase Admin SDK
let firebaseApp: admin.app.App | null = null;

export const initializeFirebase = () => {
  try {
    // Check if already initialized
    if (firebaseApp) {
      return firebaseApp;
    }

    // Try to load service account from environment or file
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    
    if (serviceAccountPath) {
      const serviceAccount = require(path.resolve(serviceAccountPath));
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin SDK initialized');
    } else {
      console.warn('⚠️ Firebase service account not configured. Push notifications will not work.');
      console.warn('   Set FIREBASE_SERVICE_ACCOUNT_PATH in .env to enable push notifications');
    }

    return firebaseApp;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
};

interface PushNotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: string;
  data?: Record<string, any>;
}

export const sendPushNotification = async (payload: PushNotificationPayload): Promise<void> => {
  try {
    // Save notification to database for history
    await prisma.notification.create({
      data: {
        userId: payload.userId,
        title: payload.title,
        message: payload.message,
        type: payload.type,
        data: payload.data || {},
        read: false,
      },
    });

    // Get user's device tokens
    const deviceTokens = await prisma.deviceToken.findMany({
      where: { userId: payload.userId },
    });

    if (deviceTokens.length === 0) {
      console.log(`No device tokens found for user ${payload.userId}`);
      return;
    }

    // Initialize Firebase if not already done
    if (!firebaseApp) {
      firebaseApp = initializeFirebase();
      if (!firebaseApp) {
        console.warn('Firebase not initialized. Cannot send push notification.');
        return;
      }
    }

    // Prepare FCM message
    const message: admin.messaging.MulticastMessage = {
      notification: {
        title: payload.title,
        body: payload.message,
      },
      data: {
        type: payload.type,
        ...(payload.data || {}),
        // Convert all data values to strings (FCM requirement)
        ...Object.entries(payload.data || {}).reduce((acc, [key, value]) => {
          acc[key] = String(value);
          return acc;
        }, {} as Record<string, string>),
      },
      tokens: deviceTokens.map(dt => dt.token),
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high' as any,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.message,
            },
            sound: 'default',
            badge: await getUnreadNotificationCount(payload.userId),
          },
        },
      },
    };

    // Send to all devices
    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📱 Push notification sent to ${response.successCount}/${deviceTokens.length} devices`);
    
    // Remove invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens: string[] = [];
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && deviceTokens[idx]) {
          const error = resp.error;
          // Remove tokens that are invalid or unregistered
          if (
            error?.code === 'messaging/invalid-registration-token' ||
            error?.code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(deviceTokens[idx].token);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await prisma.deviceToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        console.log(`🗑️  Removed ${invalidTokens.length} invalid device tokens`);
      }
    }
  } catch (error) {
    console.error('Failed to send push notification:', error);
    throw error;
  }
};

export const registerDeviceToken = async (userId: string, token: string, platform: string, deviceId?: string): Promise<void> => {
  try {
    await prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId,
        platform,
        deviceId,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token,
        platform,
        deviceId,
      },
    });
    console.log(`✅ Device token registered for user ${userId}`);
  } catch (error) {
    console.error('Failed to register device token:', error);
    throw error;
  }
};

export const unregisterDeviceToken = async (token: string): Promise<void> => {
  try {
    await prisma.deviceToken.delete({
      where: { token },
    });
    console.log(`✅ Device token unregistered: ${token}`);
  } catch (error) {
    console.error('Failed to unregister device token:', error);
    // Don't throw - token might not exist
  }
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> => {
  try {
    const count = await prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
    return count;
  } catch (error) {
    console.error('Failed to get unread notification count:', error);
    return 0;
  }
};

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  try {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    throw error;
  }
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    throw error;
  }
};

export const getUserNotifications = async (userId: string, limit = 50, offset = 0) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return notifications;
  } catch (error) {
    console.error('Failed to get user notifications:', error);
    return [];
  }
};
