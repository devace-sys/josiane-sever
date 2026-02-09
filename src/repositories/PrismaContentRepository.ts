import { PrismaClient, Content, PatientContent } from '@prisma/client';
import { IContentRepository } from './interfaces/IContentRepository';

export class PrismaContentRepository implements IContentRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(isPublic?: boolean, patientId?: string): Promise<Content[]> {
    const where: any = {};
    if (isPublic !== undefined) where.isPublic = isPublic;
    if (patientId) {
      where.OR = [
        { isPublic: true },
        {
          patientAccess: {
            some: {
              patientId,
            },
          },
        },
      ];
    }

    return this.prisma.content.findMany({
      where,
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
    });
  }

  async findById(id: string): Promise<Content | null> {
    return this.prisma.content.findUnique({
      where: { id },
      include: {
        creator: true,
        patientAccess: true,
      },
    });
  }

  async create(data: Omit<Content, 'id' | 'createdAt' | 'updatedAt'>): Promise<Content> {
    return this.prisma.content.create({
      data,
      include: {
        creator: true,
      },
    });
  }

  async update(id: string, data: Partial<Content>): Promise<Content> {
    return this.prisma.content.update({
      where: { id },
      data,
      include: {
        creator: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.content.delete({
      where: { id },
    });
  }

  async assignToPatient(contentId: string, patientId: string): Promise<PatientContent> {
    return this.prisma.patientContent.upsert({
      where: {
        patientId_contentId: {
          patientId,
          contentId,
        },
      },
      create: {
        patientId,
        contentId,
      },
      update: {},
    });
  }

  async markAsViewed(contentId: string, patientId: string): Promise<PatientContent> {
    return this.prisma.patientContent.update({
      where: {
        patientId_contentId: {
          patientId,
          contentId,
        },
      },
      data: {
        viewedAt: new Date(),
      },
    });
  }

  async getPatientContent(patientId: string): Promise<Content[]> {
    return this.prisma.content.findMany({
      where: {
        OR: [
          { isPublic: true },
          {
            patientAccess: {
              some: {
                patientId,
              },
            },
          },
        ],
      },
      include: {
        creator: true,
        patientAccess: {
          where: {
            patientId,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

