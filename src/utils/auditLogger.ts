import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuditLogData {
  userId?: string;
  userType?: UserType;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}

export const auditLogger = {
  async log(data: AuditLogData): Promise<void> {
    try {
      // Validate required fields
      if (!data.action) {
        console.error('Cannot create audit log: action is required');
        return;
      }
      
      // Validate optional but important fields
      if (!data.userId && !data.userType) {
        console.warn('Audit log created without userId or userType');
      }
      
      await prisma.auditLog.create({
        data: {
          userId: data.userId || null,
          userType: data.userType || null,
          action: data.action,
          resourceType: data.resourceType || null,
          resourceId: data.resourceId || null,
          details: data.details ? JSON.parse(JSON.stringify(data.details)) : null,
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
        },
      });
    } catch (error) {
      // Don't throw - audit logging should not break the application
      console.error('Failed to log audit event:', error);
    }
  },
};

