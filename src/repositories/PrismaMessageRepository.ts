import { PrismaClient, Message } from '@prisma/client';
import { IMessageRepository } from './interfaces/IMessageRepository';

export class PrismaMessageRepository implements IMessageRepository {
  constructor(private prisma: PrismaClient) {}

  async findByPatient(patientId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { patientId },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({
      where: { id },
      include: {
        sender: {
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
        // Message.patient references User directly (not Patient)
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
      },
    });
  }

  async create(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    return this.prisma.message.create({
      data,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
            userType: true,
            role: true,
          },
        },
      },
    });
  }

  async markAsRead(messageId: string): Promise<Message> {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(patientId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: {
        patientId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }

  async getUnreadCount(patientId: string): Promise<number> {
    return this.prisma.message.count({
      where: {
        patientId,
        isRead: false,
      },
    });
  }
}

