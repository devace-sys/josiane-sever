import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { safeResolveFilePath } from './fileUtils';

const prisma = new PrismaClient();

/**
 * Find and return orphaned session files (files in database that don't exist on filesystem)
 */
export async function findOrphanedSessionFiles(): Promise<Array<{ id: string; filePath: string; fileName: string }>> {
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  const orphanedFiles: Array<{ id: string; filePath: string; fileName: string }> = [];

  // Get all session files from database
  const sessionFiles = await prisma.sessionFile.findMany({
    select: {
      id: true,
      filePath: true,
      fileName: true,
    },
  });

  for (const file of sessionFiles) {
    if (file.filePath) {
      const resolvedPath = safeResolveFilePath(uploadsDir, file.filePath);
      if (resolvedPath && !fs.existsSync(resolvedPath)) {
        orphanedFiles.push({
          id: file.id,
          filePath: file.filePath,
          fileName: file.fileName,
        });
      }
    }
  }

  return orphanedFiles;
}

/**
 * Find and return files on filesystem that don't have database records
 */
export async function findOrphanedFilesystemFiles(): Promise<string[]> {
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  const orphanedFiles: string[] = [];

  // Get all file paths from database
  const dbFiles = new Set<string>();
  
  const sessionFiles = await prisma.sessionFile.findMany({
    select: { filePath: true },
  });
  sessionFiles.forEach(f => {
    if (f.filePath) {
      const resolvedPath = safeResolveFilePath(uploadsDir, f.filePath);
      if (resolvedPath) {
        dbFiles.add(resolvedPath);
      }
    }
  });

  // Get message attachments
  const messageAttachments = await prisma.messageAttachment.findMany({
    select: { filePath: true },
  });
  messageAttachments.forEach(f => {
    if (f.filePath) {
      const resolvedPath = safeResolveFilePath(uploadsDir, f.filePath);
      if (resolvedPath) {
        dbFiles.add(resolvedPath);
      }
    }
  });

  // Get patient uploads
  const patientUploads = await prisma.patientUpload.findMany({
    select: { filePath: true },
  });
  patientUploads.forEach(f => {
    if (f.filePath) {
      const resolvedPath = safeResolveFilePath(uploadsDir, f.filePath);
      if (resolvedPath) {
        dbFiles.add(resolvedPath);
      }
    }
  });

  // Scan filesystem
  if (fs.existsSync(uploadsDir)) {
    const scanDirectory = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDirectory(fullPath);
          } else if (entry.isFile()) {
            if (!dbFiles.has(fullPath)) {
              orphanedFiles.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    };
    scanDirectory(uploadsDir);
  }

  return orphanedFiles;
}

/**
 * Clean up orphaned database records (files that don't exist on filesystem)
 */
export async function cleanupOrphanedDatabaseFiles(): Promise<{ deleted: number; errors: number }> {
  const orphanedFiles = await findOrphanedSessionFiles();
  let deleted = 0;
  let errors = 0;

  for (const file of orphanedFiles) {
    try {
      await prisma.sessionFile.delete({
        where: { id: file.id },
      });
      deleted++;
      console.log(`✅ Deleted orphaned database record: ${file.fileName} (${file.id})`);
    } catch (error) {
      errors++;
      console.error(`❌ Failed to delete orphaned database record ${file.id}:`, error);
    }
  }

  return { deleted, errors };
}

/**
 * Clean up orphaned filesystem files (files that don't have database records)
 */
export async function cleanupOrphanedFilesystemFiles(): Promise<{ deleted: number; errors: number }> {
  const orphanedFiles = await findOrphanedFilesystemFiles();
  let deleted = 0;
  let errors = 0;

  for (const filePath of orphanedFiles) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted++;
        console.log(`✅ Deleted orphaned filesystem file: ${filePath}`);
      }
    } catch (error) {
      errors++;
      console.error(`❌ Failed to delete orphaned filesystem file ${filePath}:`, error);
    }
  }

  return { deleted, errors };
}

/**
 * Clean up files for deleted sessions
 */
export async function cleanupDeletedSessionFiles(): Promise<{ deleted: number; errors: number }> {
  // Find session files where the session no longer exists
  const allSessionFiles = await prisma.sessionFile.findMany({
    select: {
      id: true,
      sessionId: true,
      filePath: true,
      fileName: true,
    },
  });

  let deleted = 0;
  let errors = 0;

  for (const file of allSessionFiles) {
    const session = await prisma.session.findUnique({
      where: { id: file.sessionId },
      select: { id: true },
    });

    if (!session) {
      // Session doesn't exist, but file record still does (shouldn't happen with cascade, but check anyway)
      try {
        // Delete from database
        await prisma.sessionFile.delete({
          where: { id: file.id },
        });

        // Delete from filesystem
        if (file.filePath) {
          const uploadsDir = path.resolve(__dirname, '../../uploads');
          const resolvedPath = safeResolveFilePath(uploadsDir, file.filePath);
          if (resolvedPath && fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
          }
        }

        deleted++;
        console.log(`✅ Cleaned up file for deleted session: ${file.fileName} (session: ${file.sessionId})`);
      } catch (error) {
        errors++;
        console.error(`❌ Failed to clean up file for deleted session ${file.id}:`, error);
      }
    }
  }

  return { deleted, errors };
}

/**
 * Run all cleanup operations
 */
export async function runFullCleanup(): Promise<{
  orphanedDbFiles: { deleted: number; errors: number };
  orphanedFsFiles: { deleted: number; errors: number };
  deletedSessionFiles: { deleted: number; errors: number };
}> {
  console.log('🧹 Starting file cleanup...');

  const orphanedDbFiles = await cleanupOrphanedDatabaseFiles();
  const orphanedFsFiles = await cleanupOrphanedFilesystemFiles();
  const deletedSessionFiles = await cleanupDeletedSessionFiles();

  console.log('✅ File cleanup completed');
  console.log(`   - Orphaned DB records: ${orphanedDbFiles.deleted} deleted, ${orphanedDbFiles.errors} errors`);
  console.log(`   - Orphaned FS files: ${orphanedFsFiles.deleted} deleted, ${orphanedFsFiles.errors} errors`);
  console.log(`   - Deleted session files: ${deletedSessionFiles.deleted} deleted, ${deletedSessionFiles.errors} errors`);

  return {
    orphanedDbFiles,
    orphanedFsFiles,
    deletedSessionFiles,
  };
}
