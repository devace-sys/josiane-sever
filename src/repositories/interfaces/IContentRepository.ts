import { Content, PatientContent } from '@prisma/client';

export interface IContentRepository {
  // Content CRUD
  findAll(isPublic?: boolean, patientId?: string): Promise<Content[]>;
  findById(id: string): Promise<Content | null>;
  create(data: Omit<Content, 'id' | 'createdAt' | 'updatedAt'>): Promise<Content>;
  update(id: string, data: Partial<Content>): Promise<Content>;
  delete(id: string): Promise<void>;

  // Patient Content Access
  assignToPatient(contentId: string, patientId: string): Promise<PatientContent>;
  markAsViewed(contentId: string, patientId: string): Promise<PatientContent>;
  getPatientContent(patientId: string): Promise<Content[]>;
}

