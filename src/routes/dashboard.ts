import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { checkPatientAccess } from '../middleware/patientAccess';
import { flattenPatientArray } from '../utils/patientHelpers';

const router = express.Router();
const prisma = new PrismaClient();

// Get operator dashboard
router.get('/operator', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'OPERATOR') {
      return res.status(403).json({ error: 'Operator access required' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let totalPatients = 0;
    let activePatients = 0;
    let sessionsToday = 0;
    let pendingMessages = 0;
    let pendingUploads = 0;

    if (req.user.role === 'ADMIN') {
      // Parallelize dashboard queries with Promise.all
      [totalPatients, activePatients, sessionsToday, pendingMessages, pendingUploads] = await Promise.all([
        prisma.user.count({ 
          where: { 
            isActive: true,
            userType: 'PATIENT',
          } 
        }),
        prisma.user.count({ 
          where: { 
            isActive: true,
            userType: 'PATIENT',
            patientProfile: {
              isInTreatment: true 
            }
          } 
        }),
        prisma.session.count({
          where: {
            date: {
              gte: today,
              lt: tomorrow,
            },
          },
        }),
        // Unread messages: count messages FROM patients (senderId = patientId)
        prisma.message.count({
          where: {
            isRead: false,
            sender: {
              userType: 'PATIENT',
            },
          },
        }),
        prisma.patientUpload.count({
          where: {
            status: 'PENDING',
          },
        }),
      ]);
    } else {
      const accesses = await prisma.patientAccess.findMany({
        where: { operatorId: req.user.id, canView: true },
      });
      totalPatients = accesses.length;
      // Get patient profiles to check isInTreatment
      const accessPatientIds = accesses.map(a => a.patientId);
      const patients = await prisma.user.findMany({
        where: { 
          id: { in: accessPatientIds },
          userType: 'PATIENT',
        },
        include: {
          patientProfile: true,
        },
      });
      activePatients = patients.filter(p => p.patientProfile?.isInTreatment).length;
      
      const patientIds = accesses.map(a => a.patientId);
      sessionsToday = await prisma.session.count({
        where: {
          patientId: { in: patientIds },
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
      });
      // Unread messages: count messages FROM patients (senderId = patientId) where patientId in accessible patients
      pendingMessages = await prisma.message.count({
        where: {
          patientId: { in: patientIds },
          isRead: false,
          sender: {
            userType: 'PATIENT',
            id: {
              in: patientIds, // senderId must be one of the accessible patients
            },
          },
        },
      });
      pendingUploads = await prisma.patientUpload.count({
        where: {
          patientId: { in: patientIds },
          status: 'PENDING',
        },
      });
    }

    // Get recent patients
    let recentPatients: any[] = [];
    if (req.user.role === 'ADMIN') {
      const users = await prisma.user.findMany({
        where: { 
          isActive: true,
          userType: 'PATIENT',
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          patientProfile: true,
        },
      });
      // Map to expected format
      recentPatients = users.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        profileImage: u.profileImage,
        phone: u.phone,
        dateOfBirth: u.patientProfile?.dateOfBirth,
        isInTreatment: u.patientProfile?.isInTreatment || false,
        createdAt: u.createdAt,
      }));
    } else {
      const accesses = await prisma.patientAccess.findMany({
        where: { operatorId: req.user.id, canView: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: {
            include: {
              patientProfile: true,
            },
          },
        },
      });
      // Map to expected format with null checks
      recentPatients = accesses
        .filter(a => a && a.patient && a.patient.id) // Filter out any null/invalid accesses
        .map(a => ({
          id: a.patient.id,
          firstName: a.patient.firstName || null,
          lastName: a.patient.lastName || null,
          email: a.patient.email || null,
          profileImage: a.patient.profileImage || null,
          phone: a.patient.phone || null,
          dateOfBirth: a.patient.patientProfile?.dateOfBirth || null,
          isInTreatment: a.patient.patientProfile?.isInTreatment || false,
          createdAt: a.patient.createdAt,
        }));
    }

    // Get today's schedule
    let todaySchedule: any[] = [];
    if (req.user.role === 'ADMIN') {
      todaySchedule = await prisma.session.findMany({
        where: {
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
        include: {
          // Session.patient references User directly (not Patient)
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              patientProfile: true, // Include relation in select (not include)
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { date: 'asc' },
      });
    } else {
      const accesses = await prisma.patientAccess.findMany({
        where: { operatorId: req.user.id, canView: true },
      });
      const patientIds = accesses.map(a => a.patientId);
      
      todaySchedule = await prisma.session.findMany({
        where: {
          patientId: { in: patientIds },
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
        include: {
          // Session.patient references User directly (not Patient)
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              patientProfile: true, // Include relation in select (not include)
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { date: 'asc' },
      });
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      stats: {
        totalPatients,
        activePatients,
        sessionsToday,
        pendingMessages,
        pendingUploads,
      },
      recentPatients,
      todaySchedule,
    });
  } catch (error) {
    console.error('Get operator dashboard error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch dashboard: ${errorMessage}` });
  }
});

// Get patient dashboard
router.get('/patient', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Patient access required' });
    }

    const patientId = req.user.id;

    // Get upcoming session
    const upcomingSession = await prisma.session.findFirst({
      where: {
        patientId,
        date: {
          gte: new Date(),
        },
        status: 'SCHEDULED',
      },
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    // Get stats
    const totalSessionsCompleted = await prisma.session.count({
      where: {
        patientId,
        status: 'COMPLETED',
      },
    });

    const totalSessionsScheduled = await prisma.session.count({
      where: {
        patientId,
        status: 'SCHEDULED',
      },
    });

    const totalSessions = totalSessionsCompleted + totalSessionsScheduled;

    const recentSessions = await prisma.session.findMany({
      where: {
        patientId,
        status: {
          not: 'CANCELLED',
        },
      },
      take: 3,
      include: {
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Get all checklists for patient
    const allChecklists = await prisma.checklist.findMany({
      where: { patientId },
    });

    // Calculate checklist statistics
    const activeChecklists = allChecklists.filter(c => !c.completed);
    const completedChecklistsCount = allChecklists.filter(c => c.completed).length;
    let pendingItemsCount = 0;
    let totalItemsCount = 0;

    allChecklists.forEach(checklist => {
      if (Array.isArray(checklist.items)) {
        totalItemsCount += checklist.items.length;
        if (!checklist.completed) {
          const pendingItems = checklist.items.filter((item: any) => !item.completed);
          pendingItemsCount += pendingItems.length;
        }
      }
    });

    // Get assigned content (for dashboard)
    const assignedContent = await prisma.patientContent.findMany({
      where: { patientId },
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
      orderBy: { createdAt: 'desc' },
      take: 5, // Show 5 most recent assigned content
    });

    const contentAssigned = assignedContent.map(ac => ({
      ...ac.content,
      isViewed: !!ac.viewedAt,
      viewedAt: ac.viewedAt,
      isNew: !ac.viewedAt, // "new" badge if viewedAt is null
      patientContentId: ac.id,
    }));

    res.json({
      upcomingSession,
      stats: {
        totalSessions: totalSessionsCompleted,
        totalSessionsCompleted,
        totalSessionsScheduled,
        totalSessionsPlanned: totalSessions, // Total of all sessions (completed + scheduled)
      },
      recentSessions,
      checklistSummary: {
        activeChecklists: activeChecklists.length,
        completedChecklists: completedChecklistsCount,
        pendingItemsCount: pendingItemsCount,
        totalItemsCount: totalItemsCount,
      },
      contentAssigned,
    });
  } catch (error) {
    console.error('Get patient dashboard error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ error: `Failed to fetch dashboard: ${errorMessage}` });
  }
});

export default router;


