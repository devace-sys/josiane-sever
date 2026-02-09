import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';

const prisma = new PrismaClient();

export const checkPatientAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const patientId = req.params.patientId || req.body.patientId;
    
    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID required' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // If user is a patient, they can only access their own data
    if (req.user.userType === 'PATIENT') {
      if (req.user.id !== patientId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return next();
    }

    // For operators, check if they have access to this patient
    const hasAccess = await prisma.patientAccess.findUnique({
      where: {
        patientId_operatorId: {
          patientId,
          operatorId: req.user.id
        }
      }
    });

    // Admin can access all patients
    if (req.user.role === 'ADMIN') {
      return next();
    }

    if (!hasAccess || !hasAccess.canView) {
      return res.status(403).json({ error: 'No access to this patient' });
    }

    // Store access info for use in route handlers
    (req as any).patientAccess = hasAccess;
    next();
  } catch (error) {
    console.error('Error checking patient access:', error);
    return res.status(500).json({ error: 'Error checking access' });
  }
};

// Middleware to check if operator has edit permission
export const checkCanEdit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Patients can always edit their own data
    if (req.user.userType === 'PATIENT') {
      return next();
    }

    // CRITICAL FIX: Admin can VIEW but cannot EDIT patient medical data
    // Only assigned doctors (SUPPORT/BASIC) can edit
    if (req.user.role === 'ADMIN') {
      return res.status(403).json({ 
        error: 'Administrators can view patient data but cannot edit medical information. Only assigned doctors can edit patient records.' 
      });
    }

    // Get patient ID from params or body
    const patientId = req.params.patientId || req.body.patientId;
    
    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID required' });
    }

    // Check if operator has edit access
    const hasAccess = await prisma.patientAccess.findUnique({
      where: {
        patientId_operatorId: {
          patientId,
          operatorId: req.user.id
        }
      }
    });

    if (!hasAccess || !hasAccess.canEdit) {
      return res.status(403).json({ error: 'Edit permission required' });
    }

    next();
  } catch (error) {
    console.error('Error checking edit permission:', error);
    return res.status(500).json({ error: 'Error checking edit permission' });
  }
};



