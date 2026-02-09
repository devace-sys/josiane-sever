import { PrismaClient, Showcase } from '@prisma/client';
import { IShowcaseRepository } from './interfaces/IShowcaseRepository';

export class PrismaShowcaseRepository implements IShowcaseRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(status?: string): Promise<Showcase[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.prisma.showcase.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
        approver: {
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

  async findByPatient(patientId: string): Promise<Showcase | null> {
    return this.prisma.showcase.findUnique({
      where: { patientId },
      include: {
        patient: true,
        approver: true,
      },
    });
  }

  async findById(id: string): Promise<Showcase | null> {
    return this.prisma.showcase.findUnique({
      where: { id },
      include: {
        patient: true,
        approver: true,
      },
    });
  }

  async create(data: Omit<Showcase, 'id' | 'createdAt' | 'updatedAt' | 'approvedBy' | 'approvedAt' | 'rejectionReason'>): Promise<Showcase> {
    return this.prisma.showcase.create({
      data: {
        ...data,
        status: 'PENDING',
      },
      include: {
        patient: true,
      },
    });
  }

  async update(id: string, data: Partial<Showcase>): Promise<Showcase> {
    return this.prisma.showcase.update({
      where: { id },
      data,
      include: {
        patient: true,
        approver: true,
      },
    });
  }

  async approve(id: string, approvedBy: string): Promise<Showcase> {
    return this.prisma.showcase.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        patient: true,
        approver: true,
      },
    });
  }

  async reject(id: string, approvedBy: string, reason: string): Promise<Showcase> {
    return this.prisma.showcase.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedBy,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
      include: {
        patient: true,
        approver: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.showcase.delete({
      where: { id },
    });
  }
}

