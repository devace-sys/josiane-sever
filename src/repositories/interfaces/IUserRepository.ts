import { User } from '@prisma/client';

export interface IUserRepository {
  // User CRUD
  findAll(role?: string): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
  activate(id: string): Promise<User>;
  deactivate(id: string): Promise<User>;
}

