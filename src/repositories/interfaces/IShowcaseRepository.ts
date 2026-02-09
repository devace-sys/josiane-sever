import { Showcase } from '@prisma/client';

export interface IShowcaseRepository {
  // Showcase CRUD
  findAll(status?: string): Promise<Showcase[]>;
  findByPatient(patientId: string): Promise<Showcase | null>;
  findById(id: string): Promise<Showcase | null>;
  create(data: Omit<Showcase, 'id' | 'createdAt' | 'updatedAt' | 'approvedBy' | 'approvedAt' | 'rejectionReason'>): Promise<Showcase>;
  update(id: string, data: Partial<Showcase>): Promise<Showcase>;
  approve(id: string, approvedBy: string): Promise<Showcase>;
  reject(id: string, approvedBy: string, reason: string): Promise<Showcase>;
  delete(id: string): Promise<void>;
}

