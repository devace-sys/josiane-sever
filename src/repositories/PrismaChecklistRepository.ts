import { PrismaClient, Checklist, Prisma } from '@prisma/client';
import { IChecklistRepository } from './interfaces/IChecklistRepository';

export class PrismaChecklistRepository implements IChecklistRepository {
  constructor(private prisma: PrismaClient) {}

  async findByPatient(patientId: string): Promise<Checklist[]> {
    return this.prisma.checklist.findMany({
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
    });
  }

  async findById(id: string): Promise<Checklist | null> {
    return this.prisma.checklist.findUnique({
      where: { id },
      include: {
        operator: true,
        patient: true,
      },
    });
  }

  async create(data: Omit<Checklist, 'id' | 'createdAt' | 'updatedAt'>): Promise<Checklist> {
    // Convert JsonValue to InputJsonValue for Prisma
    const createData: Prisma.ChecklistCreateInput = {
      title: data.title,
      description: data.description,
      items: data.items as Prisma.InputJsonValue,
      dueDate: data.dueDate,
      completed: data.completed ?? false,
      completedAt: data.completedAt,
      patient: {
        connect: { id: data.patientId },
      },
      operator: {
        connect: { id: data.operatorId },
      },
    };

    return this.prisma.checklist.create({
      data: createData,
      include: {
        operator: true,
        patient: true,
      },
    });
  }

  async update(id: string, data: Partial<Checklist>): Promise<Checklist> {
    // Build update data, excluding fields that shouldn't be updated directly
    const updateData: Prisma.ChecklistUpdateInput = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.items !== undefined) updateData.items = data.items as Prisma.InputJsonValue;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.completed !== undefined) updateData.completed = data.completed;
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
    if (data.patientId !== undefined) {
      updateData.patient = { connect: { id: data.patientId } };
    }
    if (data.operatorId !== undefined) {
      updateData.operator = { connect: { id: data.operatorId } };
    }

    return this.prisma.checklist.update({
      where: { id },
      data: updateData,
      include: {
        operator: true,
        patient: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.checklist.delete({
      where: { id },
    });
  }

  async markComplete(id: string): Promise<Checklist> {
    return this.prisma.checklist.update({
      where: { id },
      data: {
        completed: true,
        completedAt: new Date(),
      },
      include: {
        operator: true,
        patient: true,
      },
    });
  }
}

