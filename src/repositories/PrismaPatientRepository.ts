import { PrismaClient, Patient, PatientAccess, User } from '@prisma/client';
import { IPatientRepository } from './interfaces/IPatientRepository';

export class PrismaPatientRepository implements IPatientRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(operatorId?: string): Promise<Patient[]> {
    if (operatorId) {
      return this.prisma.patient.findMany({
        where: {
          user: {
            userType: 'PATIENT',
            isActive: true,
            patientAccessesAsPatient: {
              some: {
                operatorId,
                canView: true,
              },
            },
          },
        },
        include: {
          user: {
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
              lastLoginAt: true,
              isOnline: true,
              lastSeenAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });
    }
    return this.prisma.patient.findMany({
      where: {
        user: {
          userType: 'PATIENT',
        },
      },
      include: {
        user: {
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
            lastLoginAt: true,
            isOnline: true,
            lastSeenAt: true,
            createdAt: true,
            updatedAt: true,
            patientAccessesAsPatient: {
              include: {
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async findById(id: string, operatorId?: string): Promise<Patient | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        patientProfile: true,
        patientAccessesAsPatient: {
          include: {
            operator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.userType !== 'PATIENT') return null;

    if (operatorId) {
      const hasAccess = await this.hasAccess(id, operatorId);
      if (!hasAccess) return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      profileImage: user.profileImage,
      dateOfBirth: user.patientProfile?.dateOfBirth || null,
      isInTreatment: user.patientProfile?.isInTreatment ?? true,
      medicalHistory: user.patientProfile?.medicalHistory || null,
      allergies: user.patientProfile?.allergies || null,
      medications: user.patientProfile?.medications || null,
      previousTreatments: user.patientProfile?.previousTreatments || null,
      notes: user.patientProfile?.notes || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isActive: user.isActive,
    } as Patient;
  }

  /** Returns raw user with patientProfile and patientAccessesAsPatient for detail + assigned operators */
  async findUserWithAccesses(id: string, operatorId?: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        patientProfile: true,
        patientAccessesAsPatient: {
          include: {
            operator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.userType !== 'PATIENT') return null;

    if (operatorId) {
      const hasAccess = await this.hasAccess(id, operatorId);
      if (!hasAccess) return null;
    }

    return user;
  }

  async findByEmail(email: string): Promise<Patient | null> {
    // Check User table for email, then get Patient profile
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        patientProfile: true,
      },
    });

    if (!user || user.userType !== 'PATIENT' || !user.patientProfile) {
      return null;
    }

    return user.patientProfile;
  }

  async create(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    dateOfBirth?: Date | null;
    medicalHistory?: string | null;
    allergies?: string | null;
    medications?: string | null;
    previousTreatments?: string | null;
    notes?: string | null;
    isInTreatment?: boolean;
    mustChangePassword?: boolean;
    inviteToken?: string | null;
    inviteTokenExpiresAt?: Date | null;
  }): Promise<Patient> {
    // Create User first, then Patient profile in a transaction
    return this.prisma.$transaction(async (tx) => {
      // Create User with userType=PATIENT
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          userType: 'PATIENT',
          role: 'BASIC',
          isActive: true,
          mustChangePassword: data.mustChangePassword ?? true,
          inviteToken: data.inviteToken,
          inviteTokenExpiresAt: data.inviteTokenExpiresAt,
        },
      });

      // Create Patient profile with same ID as User
      const patient = await tx.patient.create({
        data: {
          id: user.id, // Patient.id = User.id
          dateOfBirth: data.dateOfBirth,
          isInTreatment: data.isInTreatment ?? true,
          medicalHistory: data.medicalHistory,
          allergies: data.allergies,
          medications: data.medications,
          previousTreatments: data.previousTreatments,
          notes: data.notes,
        },
        include: {
          user: {
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
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      return patient;
    });
  }

  async update(id: string, data: Partial<{
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    dateOfBirth?: Date | null;
    isInTreatment?: boolean;
    medicalHistory?: string | null;
    allergies?: string | null;
    medications?: string | null;
    previousTreatments?: string | null;
    notes?: string | null;
  }>): Promise<Patient> {
    // Update both User and Patient tables
    return this.prisma.$transaction(async (tx) => {
      // Update User table for basic fields
      if (data.firstName !== undefined || data.lastName !== undefined || data.phone !== undefined) {
        await tx.user.update({
          where: { id },
          data: {
            ...(data.firstName !== undefined && { firstName: data.firstName }),
            ...(data.lastName !== undefined && { lastName: data.lastName }),
            ...(data.phone !== undefined && { phone: data.phone }),
          },
        });
      }

      // Update Patient table for medical fields
      const patient = await tx.patient.update({
        where: { id },
        data: {
          ...(data.dateOfBirth !== undefined && { dateOfBirth: data.dateOfBirth }),
          ...(data.isInTreatment !== undefined && { isInTreatment: data.isInTreatment }),
          ...(data.medicalHistory !== undefined && { medicalHistory: data.medicalHistory }),
          ...(data.allergies !== undefined && { allergies: data.allergies }),
          ...(data.medications !== undefined && { medications: data.medications }),
          ...(data.previousTreatments !== undefined && { previousTreatments: data.previousTreatments }),
          ...(data.notes !== undefined && { notes: data.notes }),
        },
        include: {
          user: {
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
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      return patient;
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.patient.delete({
      where: { id },
    });
  }

  async grantAccess(patientId: string, operatorId: string, canEdit: boolean = false): Promise<PatientAccess> {
    return this.prisma.patientAccess.upsert({
      where: {
        patientId_operatorId: {
          patientId,
          operatorId,
        },
      },
      create: {
        patientId,
        operatorId,
        canView: true,
        canEdit,
      },
      update: {
        canView: true,
        canEdit,
      },
    });
  }

  async revokeAccess(patientId: string, operatorId: string): Promise<void> {
    await this.prisma.patientAccess.deleteMany({
      where: {
        patientId,
        operatorId,
      },
    });
  }

  async getAccessiblePatients(operatorId: string): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      where: {
        user: {
          userType: 'PATIENT',
          isActive: true,
          patientAccessesAsPatient: {
            some: {
              operatorId,
              canView: true,
            },
          },
        },
      },
      include: {
        user: {
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
            lastLoginAt: true,
            isOnline: true,
            lastSeenAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async hasAccess(patientId: string, operatorId: string): Promise<boolean> {
    const access = await this.prisma.patientAccess.findUnique({
      where: {
        patientId_operatorId: {
          patientId,
          operatorId,
        },
      },
    });
    return access?.canView ?? false;
  }
}

