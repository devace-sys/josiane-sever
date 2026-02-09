import { io } from '../index';

interface SessionNotificationParams {
  type: string;
  sessionId: string;
  userId: string;
  userName: string;
  userType: 'PATIENT' | 'OPERATOR';
  recipientId: string;
  message: string;
  metadata?: Record<string, any>;
}

export const emitSessionNotification = (params: SessionNotificationParams) => {
  if (!io) {
    console.warn('[sessionNotifications] Socket.IO not initialized');
    return;
  }
  
  const notification = {
    type: params.type,
    sessionId: params.sessionId,
    userId: params.userId,
    userName: params.userName,
    userType: params.userType,
    message: params.message,
    timestamp: new Date(),
    ...params.metadata,
  };

  io.to(`user-${params.recipientId}`).emit('session-notification', notification);
};

export const notify = {
  sessionCreated: (sessionId: string, patientId: string, operatorId: string, operatorName: string, sessionCount: number, isPackage: boolean, date: Date) => {
    emitSessionNotification({
      type: 'session_created',
      sessionId,
      userId: operatorId,
      userName: operatorName,
      userType: 'OPERATOR',
      recipientId: patientId,
      message: isPackage 
        ? `${operatorName} created ${sessionCount} sessions for you`
        : `${operatorName} created a new session for ${date.toLocaleDateString()}`,
      metadata: { sessionCount, isPackage, date },
    });
  },

  sessionUpdated: (sessionId: string, patientId: string, operatorId: string, operatorName: string, changes: any) => {
    emitSessionNotification({
      type: 'session_updated',
      sessionId,
      userId: operatorId,
      userName: operatorName,
      userType: 'OPERATOR',
      recipientId: patientId,
      message: `${operatorName} updated your session`,
      metadata: { changes },
    });
  },

  completeRequested: (sessionId: string, requesterId: string, requesterName: string, requesterType: 'PATIENT' | 'OPERATOR', recipientId: string) => {
    emitSessionNotification({
      type: 'session_complete_request',
      sessionId,
      userId: requesterId,
      userName: requesterName,
      userType: requesterType,
      recipientId,
      message: `${requesterName} requested to mark session as completed`,
    });
  },

  completeAccepted: (sessionId: string, accepterId: string, accepterName: string, accepterType: 'PATIENT' | 'OPERATOR', recipientId: string) => {
    emitSessionNotification({
      type: 'session_completed',
      sessionId,
      userId: accepterId,
      userName: accepterName,
      userType: accepterType,
      recipientId,
      message: `${accepterName} accepted completion. Session is now completed.`,
    });
  },

  deleteRequested: (sessionId: string, requesterId: string, requesterName: string, requesterType: 'PATIENT' | 'OPERATOR', recipientId: string) => {
    emitSessionNotification({
      type: 'session_delete_request',
      sessionId,
      userId: requesterId,
      userName: requesterName,
      userType: requesterType,
      recipientId,
      message: `${requesterName} requested to delete this session`,
    });
  },

  fileUploaded: (sessionId: string, uploaderId: string, uploaderName: string, uploaderType: 'PATIENT' | 'OPERATOR', recipientId: string, fileName: string) => {
    emitSessionNotification({
      type: 'session_file_uploaded',
      sessionId,
      userId: uploaderId,
      userName: uploaderName,
      userType: uploaderType,
      recipientId,
      message: `${uploaderName} uploaded ${fileName} to the session`,
      metadata: { fileName },
    });
  },

  questionAsked: (sessionId: string, patientId: string, patientName: string, operatorId: string, question: string, questionId: string) => {
    emitSessionNotification({
      type: 'session_question_asked',
      sessionId,
      userId: patientId,
      userName: patientName,
      userType: 'PATIENT',
      recipientId: operatorId,
      message: `${patientName} asked a question in the session`,
      metadata: { question, questionId },
    });
  },

  questionAnswered: (sessionId: string, operatorId: string, operatorName: string, patientId: string, answer: string, questionId: string) => {
    emitSessionNotification({
      type: 'session_question_answered',
      sessionId,
      userId: operatorId,
      userName: operatorName,
      userType: 'OPERATOR',
      recipientId: patientId,
      message: `${operatorName} answered your question`,
      metadata: { answer, questionId },
    });
  },

  instructionAdded: (sessionId: string, operatorId: string, operatorName: string, patientId: string, professionalType: string, instruction: string) => {
    emitSessionNotification({
      type: 'session_instruction_added',
      sessionId,
      userId: operatorId,
      userName: operatorName,
      userType: 'OPERATOR',
      recipientId: patientId,
      message: `${operatorName} added new instructions to your session`,
      metadata: { professionalType, instruction },
    });
  },
};

