import { Checklist } from '@prisma/client';

export interface IChecklistRepository {
  // Checklist CRUD
  findByPatient(patientId: string): Promise<Checklist[]>;
  findById(id: string): Promise<Checklist | null>;
  create(data: Omit<Checklist, 'id' | 'createdAt' | 'updatedAt'>): Promise<Checklist>;
  update(id: string, data: Partial<Checklist>): Promise<Checklist>;
  delete(id: string): Promise<void>;
  markComplete(id: string): Promise<Checklist>;
}

