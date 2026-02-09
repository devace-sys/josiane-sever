import { Request, Response, NextFunction } from 'express';
import { AuditAction, UserType } from '@prisma/client';
import { auditLogger } from '../utils/auditLogger';
import { AuthRequest } from './auth';

export const logAudit = (
  action: AuditAction,
  resourceType?: string,
  getResourceId?: (req: Request) => string | undefined,
  getDetails?: (req: Request, res: Response) => any
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json to capture response
    res.json = function(body: any) {
      // Log audit after response is sent
      setImmediate(async () => {
        try {
          const resourceId = getResourceId ? getResourceId(req) : req.params.id || req.params.patientId || req.params.sessionId;
          
          await auditLogger.log({
            userId: req.user?.id,
            userType: req.user?.userType as UserType | undefined,
            action,
            resourceType,
            resourceId,
            details: getDetails ? getDetails(req, res) : undefined,
            ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
            userAgent: req.headers['user-agent'] || undefined,
          });
        } catch (error) {
          // Don't break the request if audit logging fails
          console.error('Audit logging error:', error);
        }
      });
      
      return originalJson(body);
    };
    
    next();
  };
};

