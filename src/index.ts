import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import { errorHandler } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

// CRITICAL: Validate required environment variables on startup
function validateEnvironment() {
  const required = ['JWT_SECRET', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Please create a .env file with the required variables.');
    console.error('\nExample .env file:');
    console.error('DATABASE_URL=postgresql://user:password@localhost:5432/healthcare_db');
    console.error('JWT_SECRET=your-secret-key-at-least-32-characters-long');
    process.exit(1);
  }
  
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters long for security.');
    console.error('Current length:', process.env.JWT_SECRET.length);
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

// Validate before starting server
validateEnvironment();

// Import routes
import authRoutes from './routes/auth';
import patientRoutes from './routes/patients';
import sessionRoutes from './routes/sessions';
import messageRoutes from './routes/messages';
import contentRoutes from './routes/content';
import checklistRoutes from './routes/checklists';
import beforeAfterRoutes from './routes/beforeAfter';
import uploadRoutes from './routes/upload';
import dashboardRoutes from './routes/dashboard';
import showcaseRoutes from './routes/showcase';
import productRoutes from './routes/products';
import adminRoutes from './routes/admin';
import clinicRoutes from './routes/clinic';
import patientUploadRoutes from './routes/patientUploads';
import auditRoutes from './routes/audit';
import notificationRoutes from './routes/notifications';
import fileRoutes from './routes/files';
import { initializeFirebase } from './services/pushNotificationService';
import exportRoutes from './routes/export';
import groupRoutes from './routes/groups';
import adminSessionsRoutes from './routes/adminSessions';
import { setSocketIO } from './utils/socket';

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Initialize Socket.IO instance for use in routes
setSocketIO(io);

// Initialize Firebase for push notifications
initializeFirebase();

const PORT = process.env.PORT || 3000;

// Configure CORS properly
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    : '*', // Allow all in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // Cache preflight requests for 24 hours
};

// Middleware
app.use(cors(corsOptions));
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev')); // Colorful logs for development
} else {
  app.use(morgan('combined')); // Standard Apache combined log format for production
}

// Import production-ready rate limiters
import { 
  apiLimiter as productionApiLimiter,
  authLimiter as productionAuthLimiter,
  createAccountLimiter,
  passwordResetLimiter,
  messageLimiter,
  uploadLimiter
} from './middleware/rateLimiter';

// Use production rate limiters
const authLimiter = productionAuthLimiter;
const apiLimiter = productionApiLimiter;

// Serve uploaded files with authentication and access control
app.use('/uploads', fileRoutes);

// Health check endpoint with database validation
app.get('/health', async (req, res) => {
  console.log('[SERVER] Health check called from:', req.ip);
  
  try {
    // Import prisma dynamically to avoid circular dependency
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();
      
      res.status(200).json({ 
        ok: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
      });
      console.log('[SERVER] Health check passed');
    } catch (dbError) {
      await prisma.$disconnect();
      throw dbError;
    }
  } catch (error) {
    console.error('[SERVER] Health check failed:', error);
    res.status(503).json({ 
      ok: false,
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// CSRF protection skipped - JWT provides protection

// API Routes with production-ready rate limiting
app.use('/api/auth/login', authLimiter); // Strict 5 attempts/15min
app.use('/api/auth/register', createAccountLimiter); // 3 accounts/hour per IP
app.use('/api/auth/forgot-password', passwordResetLimiter); // 3 attempts/hour
app.use('/api/auth/reset-password', passwordResetLimiter); // 3 attempts/hour
app.use('/api/upload', uploadLimiter); // 10 uploads/hour
app.use('/api/groups/:id/messages', messageLimiter); // 30 messages/min
app.use('/api', apiLimiter); // General 100 req/15min for all API routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/before-after', beforeAfterRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/showcase', showcaseRoutes);
app.use('/api/products', productRoutes);
// Register /api/admin/sessions before /api/admin so support role can access sessions list (dashboard)
app.use('/api/admin/sessions', adminSessionsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/clinic', clinicRoutes);
app.use('/api/patient-uploads', patientUploadRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/groups', groupRoutes);

// Track online users
const onlineUsers = new Map<string, string>(); // userId -> socketId

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  
  if (!token) {
    console.warn('Socket connection without token:', socket.id);
    return next(new Error('Authentication required'));
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return next(new Error('JWT_SECRET not configured'));
    }

    const jwtModule = require('jsonwebtoken');
    const decoded = jwtModule.verify(token, jwtSecret) as any;
    (socket as any).data = (socket as any).data || {};
    (socket as any).data.user = decoded;
    next();
  } catch (error) {
    console.error('Socket authentication failed:', error);
    next(new Error('Invalid token'));
  }
});

// Socket.io for real-time messaging and notifications
io.on('connection', (socket: any) => {
  const user = socket.data?.user;
  console.log('User connected:', socket.id, user?.email || 'unknown');
  let currentUserId: string | null = user?.id || null;

  // Join patient-specific room for chat
  socket.on('join-patient-room', (patientId: string) => {
    socket.join(`patient-${patientId}`);
    console.log(`Socket ${socket.id} joined patient-${patientId}`);
  });

  // Join user-specific room for notifications
  socket.on('join-user-room', async (userId: string) => {
    socket.join(`user-${userId}`);
    currentUserId = userId;
    onlineUsers.set(userId, socket.id);
    
    // Update database - set user online
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: true, lastSeenAt: new Date() }
      });
    } catch (err) {
      console.error('Failed to update user online status:', err);
    }
    
    // Broadcast online status
    socket.broadcast.emit('user-online', { userId });
    console.log(`Socket ${socket.id} joined user-${userId}`);
  });

  // Chat messages
  socket.on('send-message', (data: any) => {
    // Broadcast to all clients in the patient room or group room
    if (data.groupId) {
      io.to(`group-${data.groupId}`).emit('new-message', data);
    } else if (data.patientId) {
      io.to(`patient-${data.patientId}`).emit('new-message', data);
    }
  });

  // Join group room
  socket.on('join-group-room', (groupId: string) => {
    socket.join(`group-${groupId}`);
    console.log(`Socket ${socket.id} joined group-${groupId}`);
  });

  // Leave group room
  socket.on('leave-group-room', (groupId: string) => {
    socket.leave(`group-${groupId}`);
    console.log(`Socket ${socket.id} left group-${groupId}`);
  });

  socket.on('typing-start', (data: { patientId: string; userId: string }) => {
    socket.to(`patient-${data.patientId}`).emit('user-typing', { userId: data.userId, typing: true });
  });

  socket.on('typing-stop', (data: { patientId: string; userId: string }) => {
    socket.to(`patient-${data.patientId}`).emit('user-typing', { userId: data.userId, typing: false });
  });

  socket.on('disconnect', async () => {
    if (currentUserId) {
      onlineUsers.delete(currentUserId);
      socket.broadcast.emit('user-offline', { userId: currentUserId });
      
      // Update database - set user offline
      try {
        await prisma.user.update({
          where: { id: currentUserId },
          data: { isOnline: false, lastSeenAt: new Date() }
        });
      } catch (err) {
        console.error('Failed to update user offline status:', err);
      }
      
      // Cleanup: Remove from onlineUsers map to prevent memory leak
      onlineUsers.delete(currentUserId);
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server - Listen on all interfaces (0.0.0.0) to accept connections from emulators
// Using options object to explicitly specify hostname
httpServer.listen({
  port: PORT,
  host: '0.0.0.0'
}, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📱 Standard Android emulator: http://10.0.2.2:${PORT}/api`);
  console.log(`📱 LDPlayer emulator: http://172.25.32.1:${PORT}/api`);
  console.log(`🌍 Network access: http://0.0.0.0:${PORT}/api (all interfaces)`);
  console.log(`🔌 Socket.io ready for connections`);
});

export { io };