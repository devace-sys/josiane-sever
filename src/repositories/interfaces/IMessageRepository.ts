import { Message } from '@prisma/client';

export interface IMessageRepository {
  // Message CRUD
  findByPatient(patientId: string): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  create(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  markAsRead(messageId: string): Promise<Message>;
  markAllAsRead(patientId: string): Promise<void>;
  getUnreadCount(patientId: string): Promise<number>;
}

