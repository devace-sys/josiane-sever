import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Auth and allow ADMIN, SUPPORT, BASIC to list sessions (dashboard needs this for support role)
router.use(authenticateToken);
router.use(requireRole('ADMIN', 'SUPPORT', 'BASIC'));

// Get all sessions (for dashboard and session list)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ sessions });
  } catch (error) {
    console.error('Get all sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
