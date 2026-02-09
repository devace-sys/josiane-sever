import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';

const router = express.Router();
const prisma = new PrismaClient();

// Export patient data (admin or patient themselves)
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    const { format = 'json' } = req.query;

    // Get User with patientProfile and all related data
    // Split into separate queries to ensure proper type inference
    const user = await prisma.user.findUnique({
      where: { id: patientId },
      include: {
        patientProfile: true,
      },
    });

    if (!user || !user.patientProfile || user.userType !== 'PATIENT') {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Fetch all related data in parallel
    const [
      patientSessions,
      patientMessages,
      patientChecklists,
      beforeAfter,
      patientProductsAsPatient,
      patientUploads,
    ] = await Promise.all([
      prisma.session.findMany({
        where: { patientId },
        include: {
          files: true,
          instructions: true,
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: {
          date: 'asc',
        },
      }),
      prisma.message.findMany({
        where: { patientId },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              userType: true,
              role: true,
            },
          },
          attachments: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      prisma.checklist.findMany({
        where: { patientId },
        include: {
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.beforeAfter.findMany({
        where: { patientId },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.patientProduct.findMany({
        where: { patientId },
        include: {
          product: true,
        },
      }),
      prisma.patientUpload.findMany({
        where: { patientId },
        include: {
          replies: {
            include: {
              operator: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    const patient = user.patientProfile;

    // Remove sensitive data - Patient fields are now in User table
    const exportData = {
      patient: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        dateOfBirth: patient.dateOfBirth,
        medicalHistory: patient.medicalHistory,
        allergies: patient.allergies,
        medications: patient.medications,
        previousTreatments: patient.previousTreatments,
        createdAt: user.createdAt,
      },
      sessions: patientSessions,
      messages: patientMessages,
      checklists: patientChecklists,
      beforeAfter: beforeAfter,
      products: patientProductsAsPatient,
      uploads: patientUploads,
      exportDate: new Date().toISOString(),
    };

    // Log export audit
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: 'EXPORT' as any,
        resourceType: 'Patient',
        resourceId: patientId,
        details: { format, dataSize: JSON.stringify(exportData).length },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    if (format === 'csv') {
      // Convert to CSV format
      const csvRows: string[] = [];
      
      // Patient Info CSV
      csvRows.push('=== PATIENT INFORMATION ===');
      csvRows.push('Field,Value');
      csvRows.push(`ID,${exportData.patient.id}`);
      csvRows.push(`Email,${exportData.patient.email}`);
      csvRows.push(`Name,${exportData.patient.firstName} ${exportData.patient.lastName}`);
      csvRows.push(`Phone,${exportData.patient.phone || 'N/A'}`);
      csvRows.push(`Date of Birth,${exportData.patient.dateOfBirth || 'N/A'}`);
      csvRows.push(`Created,${exportData.patient.createdAt}`);
      csvRows.push('');
      
      // Sessions CSV
      csvRows.push('=== SESSIONS ===');
      csvRows.push('Date,Type,Status,Operator,Notes');
      if (exportData.sessions && Array.isArray(exportData.sessions)) {
        exportData.sessions.forEach((session: any) => {
          if (!session) return;
          const operatorName = session.operator && session.operator.firstName && session.operator.lastName 
            ? `${session.operator.firstName} ${session.operator.lastName}` 
            : 'N/A';
          const notes = (session.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
          csvRows.push(`${session.date || 'N/A'},${session.type || 'N/A'},${session.status || 'N/A'},${operatorName},"${notes}"`);
        });
      }
      csvRows.push('');
      
      // Messages CSV
      csvRows.push('=== MESSAGES ===');
      csvRows.push('Date,From,Message,Read');
      if (exportData.messages && Array.isArray(exportData.messages)) {
        exportData.messages.forEach((msg: any) => {
          if (!msg) return;
          const senderName = msg.sender && msg.sender.firstName && msg.sender.lastName 
            ? `${msg.sender.firstName} ${msg.sender.lastName}` 
            : 'System';
          const messageText = (msg.content || '').replace(/,/g, ';').replace(/\n/g, ' ');
          csvRows.push(`${msg.createdAt || 'N/A'},${senderName},"${messageText}",${msg.isRead ? 'Yes' : 'No'}`);
        });
      }
      csvRows.push('');
      
      // Checklists CSV
      csvRows.push('=== CHECKLISTS ===');
      csvRows.push('Title,Status,Created By,Items');
      if (exportData.checklists && Array.isArray(exportData.checklists)) {
        exportData.checklists.forEach((checklist: any) => {
          if (!checklist) return;
          const operatorName = checklist.operator && checklist.operator.firstName && checklist.operator.lastName 
            ? `${checklist.operator.firstName} ${checklist.operator.lastName}` 
            : 'N/A';
          const itemsText = (checklist.items || '').replace(/,/g, ';').replace(/\n/g, ' ');
          csvRows.push(`"${checklist.title || 'N/A'}",${checklist.status || 'N/A'},${operatorName},"${itemsText}"`);
        });
      }
      csvRows.push('');
      
      // Products CSV
      csvRows.push('=== PRODUCTS ===');
      csvRows.push('Product Name,Assigned Date,Usage Count');
      if (exportData.products && Array.isArray(exportData.products)) {
        exportData.products.forEach((pp: any) => {
          if (!pp) return;
          csvRows.push(`${pp.product?.name || 'N/A'},${pp.assignedAt || 'N/A'},${pp.usageCount || 0}`);
        });
      }
      csvRows.push('');
      
      // Uploads CSV
      csvRows.push('=== UPLOADS ===');
      csvRows.push('Date,Type,Description,Status');
      if (exportData.uploads && Array.isArray(exportData.uploads)) {
        exportData.uploads.forEach((upload: any) => {
          if (!upload) return;
          const desc = (upload.description || 'N/A').replace(/,/g, ';').replace(/\n/g, ' ');
          csvRows.push(`${upload.createdAt || 'N/A'},${upload.type || 'N/A'},"${desc}",${upload.status || 'N/A'}`);
        });
      }
      
      const csvContent = csvRows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=patient-${patientId}-${Date.now()}.csv`);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=patient-${patientId}-${Date.now()}.json`);
      res.json(exportData);
    }
  } catch (error) {
    console.error('Export patient data error:', error);
    res.status(500).json({ error: 'Failed to export patient data' });
  }
});

// Export all data (admin only)
router.get('/all', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { format = 'json' } = req.query;

    const [patients, users, sessions, messages, content, checklists] = await Promise.all([
      prisma.patient.findMany({
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              isActive: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.session.findMany({
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
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
        orderBy: {
          date: 'desc',
        },
      }),
      prisma.message.findMany({
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              userType: true,
              role: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.content.findMany({
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.checklist.findMany({
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
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
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      patients,
      users,
      sessions,
      messages,
      content,
      checklists,
    };

    // Log admin export audit
    if (req.user) {
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: 'EXPORT' as any,
        resourceType: 'AllPatients',
        details: { format, patientCount: patients.length },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });
    }

    if (format === 'csv') {
      // Convert to CSV format - Admin export all data
      const csvRows: string[] = [];
      
      // Patients CSV
      csvRows.push('=== ALL PATIENTS ===');
      csvRows.push('ID,Email,First Name,Last Name,Phone,Active,Created');
      if (patients && Array.isArray(patients)) {
        patients.forEach((patient: any) => {
          if (!patient) return;
          const user = patient.user || {};
          csvRows.push(`${user.id || patient.id || 'N/A'},${user.email || 'N/A'},${user.firstName || ''},${user.lastName || ''},${user.phone || ''},${user.isActive ? 'Yes' : 'No'},${user.createdAt || ''}`);
        });
      }
      csvRows.push('');
      
      // Users CSV
      csvRows.push('=== ALL USERS ===');
      csvRows.push('ID,Email,Name,Role,Active,Created');
      if (users && Array.isArray(users)) {
        users.forEach((user: any) => {
          if (!user || !user.id) return;
          csvRows.push(`${user.id},${user.email || 'N/A'},${user.firstName || ''} ${user.lastName || ''},${user.role || 'N/A'},${user.isActive ? 'Yes' : 'No'},${user.createdAt || 'N/A'}`);
        });
      }
      csvRows.push('');
      
      // Sessions CSV
      csvRows.push('=== ALL SESSIONS ===');
      csvRows.push('Date,Patient,Operator,Type,Status');
      if (sessions && Array.isArray(sessions)) {
        sessions.forEach((session: any) => {
          if (!session) return;
          const patientName = session.patient && session.patient.firstName && session.patient.lastName 
            ? `${session.patient.firstName} ${session.patient.lastName}` 
            : 'N/A';
          const operatorName = session.operator && session.operator.firstName && session.operator.lastName 
            ? `${session.operator.firstName} ${session.operator.lastName}` 
            : 'N/A';
          csvRows.push(`${session.date || 'N/A'},${patientName},${operatorName},${session.type || 'N/A'},${session.status || 'N/A'}`);
        });
      }
      csvRows.push('');
      
      // Messages Summary CSV
      csvRows.push('=== MESSAGES SUMMARY ===');
      csvRows.push('Date,Patient,Sender,Has Attachments,Read');
      if (messages && Array.isArray(messages)) {
        messages.forEach((msg: any) => {
          if (!msg) return;
          const patientName = msg.patient && msg.patient.firstName && msg.patient.lastName 
            ? `${msg.patient.firstName} ${msg.patient.lastName}` 
            : 'N/A';
          const senderName = msg.sender && msg.sender.firstName && msg.sender.lastName 
            ? `${msg.sender.firstName} ${msg.sender.lastName}` 
            : 'System';
          csvRows.push(`${msg.createdAt || 'N/A'},${patientName},${senderName},${msg.attachments?.length > 0 ? 'Yes' : 'No'},${msg.isRead ? 'Yes' : 'No'}`);
        });
      }
      csvRows.push('');
      
      // Content CSV
      csvRows.push('=== CONTENT LIBRARY ===');
      csvRows.push('Title,Type,Category,Public,Creator,Created');
      if (content && Array.isArray(content)) {
        content.forEach((item: any) => {
          if (!item) return;
          const creatorName = item.creator && item.creator.firstName && item.creator.lastName 
            ? `${item.creator.firstName} ${item.creator.lastName}` 
            : 'System';
          csvRows.push(`"${item.title || 'N/A'}",${item.contentType || 'N/A'},${item.category || 'N/A'},${item.isPublic ? 'Yes' : 'No'},${creatorName},${item.createdAt || 'N/A'}`);
        });
      }
      
      const csvContent = csvRows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=all-data-${Date.now()}.csv`);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=all-data-${Date.now()}.json`);
      res.json(exportData);
    }
  } catch (error) {
    console.error('Export all data error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

export default router;

