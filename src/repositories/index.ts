import { PrismaClient } from '@prisma/client';
import { PrismaPatientRepository } from './PrismaPatientRepository';
import { PrismaSessionRepository } from './PrismaSessionRepository';
import { PrismaMessageRepository } from './PrismaMessageRepository';
import { PrismaContentRepository } from './PrismaContentRepository';
import { PrismaChecklistRepository } from './PrismaChecklistRepository';
import { PrismaShowcaseRepository } from './PrismaShowcaseRepository';
import { PrismaUserRepository } from './PrismaUserRepository';
import { IPatientRepository } from './interfaces/IPatientRepository';
import { ISessionRepository } from './interfaces/ISessionRepository';
import { IMessageRepository } from './interfaces/IMessageRepository';
import { IContentRepository } from './interfaces/IContentRepository';
import { IChecklistRepository } from './interfaces/IChecklistRepository';
import { IShowcaseRepository } from './interfaces/IShowcaseRepository';
import { IUserRepository } from './interfaces/IUserRepository';

// Singleton Prisma Client
let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // @ts-ignore
  if (!global.prisma) {
    // @ts-ignore
    global.prisma = new PrismaClient();
  }
  // @ts-ignore
  prisma = global.prisma;
}

// Repository instances
export const patientRepository: IPatientRepository = new PrismaPatientRepository(prisma);
export const sessionRepository: ISessionRepository = new PrismaSessionRepository(prisma);
export const messageRepository: IMessageRepository = new PrismaMessageRepository(prisma);
export const contentRepository: IContentRepository = new PrismaContentRepository(prisma);
export const checklistRepository: IChecklistRepository = new PrismaChecklistRepository(prisma);
export const showcaseRepository: IShowcaseRepository = new PrismaShowcaseRepository(prisma);
export const userRepository: IUserRepository = new PrismaUserRepository(prisma);

// Export Prisma client for direct use when needed
export { prisma };

