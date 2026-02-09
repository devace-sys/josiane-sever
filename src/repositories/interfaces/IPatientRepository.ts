import { Patient, PatientAccess } from '@prisma/client';

export interface IPatientRepository {
  // Patient CRUD
  findAll(operatorId?: string): Promise<Patient[]>;
  findById(id: string, operatorId?: string): Promise<Patient | null>;
  findUserWithAccesses?(id: string, operatorId?: string): Promise<any>;
  findByEmail(email: string): Promise<Patient | null>;
  create(data: {
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
  }): Promise<Patient>;
  update(id: string, data: Partial<{
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
  }>): Promise<Patient>;
  delete(id: string): Promise<void>;

  // Patient Access
  grantAccess(patientId: string, operatorId: string, canEdit?: boolean): Promise<PatientAccess>;
  revokeAccess(patientId: string, operatorId: string): Promise<void>;
  getAccessiblePatients(operatorId: string): Promise<Patient[]>;
  hasAccess(patientId: string, operatorId: string): Promise<boolean>;
}

