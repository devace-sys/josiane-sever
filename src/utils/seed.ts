import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('❌ Seed script cannot run in production environment');
  }
  
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@healthcare.com' },
    update: {},
    create: {
      email: 'admin@healthcare.com',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      userType: 'OPERATOR',
      role: 'ADMIN',
      mustChangePassword: false,
    },
  });

  console.log('Seeded user:', { admin });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



