import { sendPushNotification } from '../services/pushNotificationService';
import { emitNotification } from './socket';

/**
 * Unified notification sender
 * Sends both Socket.IO (real-time) and push notifications
 */
export const sendNotification = async (params: {
  userId: string;
  title: string;
  message: string;
  type: string;
  data?: Record<string, any>;
}) => {
  try {
    // Send Socket.IO notification (for real-time when app is open)
    emitNotification(params.userId, {
      title: params.title,
      message: params.message,
      type: params.type,
      data: params.data,
    });

    // Send push notification (for when app is closed/background)
    await sendPushNotification({
      userId: params.userId,
      title: params.title,
      message: params.message,
      type: params.type,
      data: params.data,
    });

    console.log(`📬 Notification sent to user ${params.userId}: ${params.title}`);
  } catch (error) {
    console.error('Failed to send notification:', error);
    // Don't throw - notification failure shouldn't break the main operation
  }
};

export const NotificationType = {
  // Messages
  NEW_MESSAGE: 'NEW_MESSAGE',
  MENTION: 'MENTION',
  
  // Sessions
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_UPDATED: 'SESSION_UPDATED',
  SESSION_DELETED: 'SESSION_DELETED',
  SESSION_REMINDER: 'SESSION_REMINDER',
  SESSION_COMPLETE_REQUEST: 'SESSION_COMPLETE_REQUEST',
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  SESSION_DELETE_REQUEST: 'SESSION_DELETE_REQUEST',
  
  // Session Activities
  SESSION_FILE_UPLOADED: 'SESSION_FILE_UPLOADED',
  SESSION_INSTRUCTION_ADDED: 'SESSION_INSTRUCTION_ADDED',
  SESSION_QUESTION_ASKED: 'SESSION_QUESTION_ASKED',
  SESSION_QUESTION_ANSWERED: 'SESSION_QUESTION_ANSWERED',
  
  // Checklists
  CHECKLIST_CREATED: 'CHECKLIST_CREATED',
  CHECKLIST_UPDATED: 'CHECKLIST_UPDATED',
  CHECKLIST_DUE_SOON: 'CHECKLIST_DUE_SOON',
  CHECKLIST_COMPLETED: 'CHECKLIST_COMPLETED',
  
  // Patient Uploads
  UPLOAD_SUBMITTED: 'UPLOAD_SUBMITTED',
  UPLOAD_REVIEWED: 'UPLOAD_REVIEWED',
  UPLOAD_APPROVED: 'UPLOAD_APPROVED',
  UPLOAD_REJECTED: 'UPLOAD_REJECTED',
  UPLOAD_REPLY: 'UPLOAD_REPLY',
  
  // Content
  CONTENT_ASSIGNED: 'CONTENT_ASSIGNED',
  CONTENT_RECOMMENDED: 'CONTENT_RECOMMENDED',
  
  // Showcase
  SHOWCASE_APPROVED: 'SHOWCASE_APPROVED',
  SHOWCASE_REJECTED: 'SHOWCASE_REJECTED',
  
  // Products
  PRODUCT_ASSIGNED: 'PRODUCT_ASSIGNED',
  
  // Before/After
  BEFORE_AFTER_ADDED: 'BEFORE_AFTER_ADDED',
} as const;
