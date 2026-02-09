import { PrismaClient, User } from '@prisma/client';
import { IUserRepository } from './interfaces/IUserRepository';

export class PrismaUserRepository implements IUserRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(role?: string): Promise<User[]> {
    const where: any = {};
    if (role) {
      where.role = role;
    }

    return this.prisma.user.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        patientAccesses: {
          include: {
            // PatientAccess.patient references User directly (not Patient)
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
        },
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id },
    });
  }

  async activate(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: true },
    });
  }

  async deactivate(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

