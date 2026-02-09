import { PrismaClient, Session, SessionFile, SessionInstruction, Prisma } from '@prisma/client';
import { ISessionRepository } from './interfaces/ISessionRepository';

export class PrismaSessionRepository implements ISessionRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(patientId?: string, operatorId?: string): Promise<Session[]> {
    const where: any = {};
    if (patientId) where.patientId = patientId;
    if (operatorId) where.operatorId = operatorId;

    return this.prisma.session.findMany({
      where,
      include: {
        // Session.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
            isActive: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: true,
        instructions: true,
        questions: {
          include: {
            asker: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            answerer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        patientUploads: {
          where: {
            status: 'PENDING',
          },
        },
        feedback: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async findById(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        // Session.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
            isActive: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: true,
        instructions: true,
        feedback: true,
      },
    });
  }

  async create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session> {
    // Convert preparationChecklist JsonValue to InputJsonValue for Prisma
    const createData: any = {
      ...data,
      preparationChecklist: data.preparationChecklist !== null && data.preparationChecklist !== undefined
        ? (data.preparationChecklist as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      // Ensure packageId fields are properly set
      packageId: data.packageId || null,
      sessionNumber: data.sessionNumber || null,
      totalSessions: data.totalSessions || null,
    };
    return this.prisma.session.create({
      data: createData,
      include: {
        // Session.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
            isActive: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: true,
        instructions: true,
      },
    });
  }

  async update(id: string, data: Partial<Session>): Promise<Session> {
    // Convert preparationChecklist JsonValue to InputJsonValue for Prisma if present
    const updateData: any = { ...data };
    if (data.preparationChecklist !== undefined) {
      updateData.preparationChecklist = data.preparationChecklist !== null
        ? (data.preparationChecklist as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    return this.prisma.session.update({
      where: { id },
      data: updateData,
      include: {
        // Session.patient references User directly (not Patient)
        patient: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
            isActive: true,
            patientProfile: true, // Include relation in select (not include)
          },
        },
        operator: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
        files: true,
        instructions: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // Get session files before deletion to clean up filesystem
    const sessionFiles = await this.prisma.sessionFile.findMany({
      where: { sessionId: id },
    });

    // Delete from database (cascade will handle related records)
    await this.prisma.session.delete({
      where: { id },
    });

    // Clean up files from filesystem
    const fs = require('fs');
    const path = require('path');
    const { safeResolveFilePath } = require('../utils/fileUtils');
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    
    for (const file of sessionFiles) {
      if (file.filePath) {
        const filePath = safeResolveFilePath(uploadsDir, file.filePath);
        if (filePath) {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`✅ Deleted file: ${file.fileName}`);
            }
          } catch (fsError) {
            console.error(`Failed to delete file ${file.fileName}:`, fsError);
            // Continue with other files even if one fails
          }
        } else {
          console.warn(`⚠️ Skipped unsafe file path: ${file.filePath}`);
        }
      }
    }
  }

  async addFile(sessionId: string, fileData: Omit<SessionFile, 'id' | 'sessionId' | 'createdAt'>): Promise<SessionFile> {
    return this.prisma.sessionFile.create({
      data: {
        sessionId,
        fileType: fileData.fileType,
        filePath: fileData.filePath,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize ?? null,
        mimeType: fileData.mimeType ?? null,
        uploadedBy: fileData.uploadedBy,
        visibility: (fileData as any).visibility || 'PATIENT_VISIBLE',
      },
    });
  }

  async getFiles(sessionId: string): Promise<SessionFile[]> {
    return this.prisma.sessionFile.findMany({
      where: { sessionId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.prisma.sessionFile.delete({
      where: { id: fileId },
    });
  }

  async addInstruction(sessionId: string, instructionData: Omit<SessionInstruction, 'id' | 'sessionId' | 'createdAt'>): Promise<SessionInstruction> {
    return this.prisma.sessionInstruction.create({
      data: {
        ...instructionData,
        sessionId,
      },
    });
  }

  async getInstructions(sessionId: string): Promise<SessionInstruction[]> {
    return this.prisma.sessionInstruction.findMany({
      where: { sessionId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

