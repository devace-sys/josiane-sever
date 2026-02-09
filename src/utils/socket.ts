import { Server } from 'socket.io';

let io: Server | null = null;

export const setSocketIO = (socketIO: Server) => {
  io = socketIO;
};

export const getSocketIO = (): Server | null => {
  return io;
};

// Emit session events
export const emitSessionEvent = (eventType: string, sessionId: string, patientId: string, data: any) => {
  if (!io) {
    console.warn('[Socket.IO] Socket instance not initialized yet');
    return;
  }
  
  // Emit to patient room
  io.to(`patient-${patientId}`).emit('session-event', {
    eventType,
    sessionId,
    patientId,
    data,
    timestamp: new Date().toISOString(),
  });
  
  console.log(`[Socket.IO] Emitted ${eventType} to patient-${patientId}`);
};

// Emit notification
export const emitNotification = (userId: string, notification: { title: string; message: string; type: string; data?: any }) => {
  if (!io) {
    console.warn('[Socket.IO] Socket instance not initialized yet');
    return;
  }
  
  io.to(`user-${userId}`).emit('notification', {
    ...notification,
    timestamp: new Date().toISOString(),
  });
  
  console.log(`[Socket.IO] Emitted notification to user-${userId}`);
};

