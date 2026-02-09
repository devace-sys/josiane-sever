import { Session, SessionFile, SessionInstruction } from '@prisma/client';

export interface ISessionRepository {
  // Session CRUD
  findAll(patientId?: string, operatorId?: string): Promise<Session[]>;
  findById(id: string): Promise<Session | null>;
  create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session>;
  update(id: string, data: Partial<Session>): Promise<Session>;
  delete(id: string): Promise<void>;

  // Session Files
  addFile(sessionId: string, fileData: Omit<SessionFile, 'id' | 'sessionId' | 'createdAt'>): Promise<SessionFile>;
  getFiles(sessionId: string): Promise<SessionFile[]>;
  deleteFile(fileId: string): Promise<void>;

  // Session Instructions
  addInstruction(sessionId: string, instructionData: Omit<SessionInstruction, 'id' | 'sessionId' | 'createdAt'>): Promise<SessionInstruction>;
  getInstructions(sessionId: string): Promise<SessionInstruction[]>;
}

