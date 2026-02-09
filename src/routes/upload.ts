import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';
import { sessionRepository, prisma } from '../repositories';

const router = express.Router();

// Magic bytes (file signatures) for file type validation
const MAGIC_BYTES: { [key: string]: Buffer[] } = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'image/gif': [Buffer.from([0x47, 0x49, 0x46, 0x38])], // GIF87a or GIF89a
  'image/webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF...WEBP (check at offset 8)
  'video/mp4': [Buffer.from([0x00, 0x00, 0x00])], // MP4 files have ftyp box
  'video/quicktime': [Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74])], // QuickTime
  'video/x-msvideo': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // AVI (RIFF)
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
};

/**
 * Validate file content using magic bytes (file signatures)
 * This prevents file type spoofing by checking actual file content, not just extension/MIME type
 */
function validateMagicBytes(filePath: string, expectedMimeType: string): boolean {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const magicBytes = MAGIC_BYTES[expectedMimeType];
    
    if (!magicBytes || magicBytes.length === 0) {
      console.warn(`[UPLOAD] No magic bytes defined for MIME type: ${expectedMimeType}`);
      return true; // Allow if no magic bytes defined (fallback to MIME type check)
    }
    
    // Check if file starts with any of the expected magic byte patterns
    for (const pattern of magicBytes) {
      if (fileBuffer.length >= pattern.length) {
        const fileStart = fileBuffer.slice(0, pattern.length);
        if (fileStart.equals(pattern)) {
          // Special case for WebP: check for WEBP at offset 8
          if (expectedMimeType === 'image/webp' && fileBuffer.length >= 12) {
            const webpMarker = fileBuffer.slice(8, 12);
            if (webpMarker.equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) {
              return true;
            }
          } else if (expectedMimeType !== 'image/webp') {
            return true;
          }
        }
        // Special case for MP4: check for ftyp box
        if (expectedMimeType === 'video/mp4') {
          const header = fileBuffer.slice(0, Math.min(32, fileBuffer.length));
          if (header.includes(Buffer.from([0x66, 0x74, 0x79, 0x70]))) {
            return true;
          }
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('[UPLOAD] Error validating magic bytes:', error);
    return false;
  }
}

// Ensure uploads directories exist
const baseUploadsDir = path.join(__dirname, '../../uploads');
const profileImagesDir = path.join(baseUploadsDir, 'profile-images');
const sessionFilesDir = path.join(baseUploadsDir, 'session-files');
const contentFilesDir = path.join(baseUploadsDir, 'content-files');
const messageAttachmentsDir = path.join(baseUploadsDir, 'message-attachments');
const showcaseImagesDir = path.join(baseUploadsDir, 'showcase-images');

[baseUploadsDir, profileImagesDir, sessionFilesDir, contentFilesDir, messageAttachmentsDir, showcaseImagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer with organized storage
const sessionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, sessionFilesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'session-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profileImagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const contentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, contentFilesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'content-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// Storage for clinic logo (ADMIN only)
const clinicLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, contentFilesDir); // Use content-files directory for clinic assets
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'clinic-logo-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const messageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, messageAttachmentsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'message-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const showcaseStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, showcaseImagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fieldName = file.fieldname === 'beforeImage' ? 'before' : 'after';
    cb(null, `${fieldName}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// CRITICAL FIX: Improved file upload security with strict MIME type validation
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_DOCUMENT_MIMES = ['application/pdf'];
const ALL_ALLOWED_MIMES = [...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES, ...ALLOWED_DOCUMENT_MIMES];

// Separate multer configs for different upload types
const upload = multer({
  storage: sessionStorage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB for session files
    files: 5, // Maximum 5 files per request
  },
  fileFilter: (req, file, cb) => {
    console.log('[UPLOAD] File filter check:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Strict MIME type validation
    if (!ALL_ALLOWED_MIMES.includes(file.mimetype)) {
      const error = new Error(
        `Invalid file type: ${file.mimetype}. Allowed types: images (JPEG, PNG, GIF, WebP), videos (MP4, MOV, AVI), documents (PDF)`
      );
      console.error('[UPLOAD] File filter rejected:', error.message);
      return cb(error);
    }

    // Additional extension check as secondary validation
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.pdf'];
    if (!allowedExts.includes(ext)) {
      const error = new Error(`Invalid file extension: ${ext}`);
      console.error('[UPLOAD] File filter rejected:', error.message);
      return cb(error);
    }

    cb(null, true);
  },
});

// Larger file size limit for content uploads (videos can be large)
const contentUpload = multer({
  storage: contentStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB for content files (reasonable for most videos)
    files: 1, // One file at a time for content
  },
  fileFilter: (req, file, cb) => {
    console.log('[CONTENT UPLOAD] File filter check:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
    });

    // Strict MIME type validation for content
    const allowedMimes = [
      ...ALLOWED_IMAGE_MIMES,
      ...ALLOWED_VIDEO_MIMES,
      ...ALLOWED_DOCUMENT_MIMES,
      'video/webm',
      'video/x-matroska', // MKV
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const error = new Error(
        `Invalid content file type: ${file.mimetype}. Allowed: images, videos (MP4, MOV, AVI, WebM, MKV), PDF documents`
      );
      console.error('[CONTENT UPLOAD] File filter rejected:', error.message);
      return cb(error);
    }

    cb(null, true);
  },
});

// Clinic logo upload (ADMIN only, images only)
const clinicLogoUpload = multer({
  storage: clinicLogoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB for clinic logo
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    console.log('[CLINIC LOGO UPLOAD] File filter check:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
    });

    // Only allow images for clinic logo
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      const error = new Error(
        `Invalid file type: ${file.mimetype}. Clinic logo must be an image (JPEG, PNG, GIF, WebP)`
      );
      console.error('[CLINIC LOGO UPLOAD] File filter rejected:', error.message);
      return cb(error);
    }

    // Additional extension check
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (!allowedExts.includes(ext)) {
      const error = new Error(`Invalid file extension: ${ext}. Clinic logo must be an image`);
      console.error('[CLINIC LOGO UPLOAD] File filter rejected:', error.message);
      return cb(error);
    }

    cb(null, true);
  },
});

// Upload file for session (Both patients and operators can upload to sessions)
router.post('/session/:sessionId', authenticateToken, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    console.log('[UPLOAD] Session file upload request:', {
      sessionId: req.params.sessionId,
      hasFile: !!req.file,
      fileInfo: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      } : null,
      body: req.body,
      userType: req.user?.userType,
    });

    if (!req.file) {
      console.error('[UPLOAD] No file received in request');
      return res.status(400).json({ error: 'No file uploaded. Please ensure the file field is named "file".' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId } = req.params;
    const { fileType } = req.body;
    
    // fileType is optional, but validate if provided
    if (fileType !== undefined && fileType !== null && typeof fileType !== 'string') {
      return res.status(400).json({ error: 'Invalid fileType format' });
    }

    // Get session to check access
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { patientId: true, operatorId: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access: patient owns session OR operator has access
    if (req.user.userType === 'PATIENT') {
      // Patient can only upload to their own sessions
      if (session.patientId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You can only upload to your own sessions.' });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operator needs access permission (unless admin)
      if (req.user.role !== 'ADMIN') {
        const hasAccess = await prisma.patientAccess.findUnique({
          where: {
            patientId_operatorId: {
              patientId: session.patientId,
              operatorId: req.user.id,
            },
          },
        });

        if (!hasAccess || !hasAccess.canView) {
          return res.status(403).json({ error: 'Access to this patient required' });
        }
      }
    }

    // Validate visibility if provided
    const visibility = req.body.visibility || 'PATIENT_VISIBLE';
    if (visibility !== undefined && visibility !== null && typeof visibility !== 'string') {
      return res.status(400).json({ error: 'Invalid visibility format' });
    }
    
    const sessionFile = await sessionRepository.addFile(sessionId, {
      fileType: fileType || 'PHOTO',
      filePath: `/uploads/session-files/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
      visibility,
    } as any);

    // Log file upload
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.FILE_UPLOADED,
      resourceType: 'Session',
      resourceId: sessionId,
      details: { fileName: req.file.originalname, fileType: fileType || 'PHOTO' },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    console.log('[UPLOAD] Session file uploaded successfully:', sessionFile.id);
    res.status(201).json({ filePath: sessionFile.filePath });
  } catch (error: any) {
    console.error('[UPLOAD] Upload session file error:', error);
    res.status(500).json({ 
      error: 'Failed to upload file',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Upload profile image
router.post('/profile', authenticateToken, multer({ storage: profileStorage }).single('image'), async (req: AuthRequest, res: Response) => {
  try {
    console.log('[UPLOAD] Profile image upload request:', {
      hasFile: !!req.file,
      fileInfo: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      } : null,
    });

    if (!req.file) {
      console.error('[UPLOAD] No file received in profile upload request');
      return res.status(400).json({ error: 'No file uploaded. Please ensure the file field is named "image".' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // SECURITY: Validate file content using magic bytes
    const filePath = path.join(profileImagesDir, req.file.filename);
    if (!validateMagicBytes(filePath, req.file.mimetype)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.error('[UPLOAD] Failed to delete invalid file:', unlinkError);
      }
      return res.status(400).json({ 
        error: 'File content does not match declared file type. File may be corrupted or malicious.' 
      });
    }

    const imagePath = `/uploads/profile-images/${req.file.filename}`;

    // ALL users (patients and operators) are in the User table
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { profileImage: imagePath },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        profileImage: true,
        role: true,
      },
    });

    res.json({
      imagePath,
      profileImage: imagePath,
      user: { ...updatedUser, userType: req.user.userType },
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({ error: 'Failed to upload profile image' });
  }
});

// Upload clinic logo (ADMIN only)
router.post('/clinic-logo', authenticateToken, requireRole('ADMIN'), clinicLogoUpload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const filePath = `/uploads/content-files/${req.file.filename}`;
    
    // Log file upload
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.FILE_UPLOADED,
      resourceType: 'ClinicConfig',
      resourceId: undefined,
      details: { fileName: req.file.originalname, fileSize: req.file.size, mimeType: req.file.mimetype },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ filePath, fileName: req.file.originalname, fileSize: req.file.size });
  } catch (error: any) {
    console.error('Upload clinic logo error:', error);
    if (error.message && error.message.includes('File too large')) {
      res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
    } else {
      res.status(500).json({ error: 'Failed to upload clinic logo' });
    }
  }
});

// Upload content file
router.post('/content', authenticateToken, requireRole('ADMIN', 'SUPPORT', 'BASIC'), contentUpload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // SECURITY: Validate file content using magic bytes
    const contentFilePathFull = path.join(contentFilesDir, req.file.filename);
    if (!validateMagicBytes(contentFilePathFull, req.file.mimetype)) {
      try {
        fs.unlinkSync(contentFilePathFull);
      } catch (unlinkError) {
        console.error('[UPLOAD] Failed to delete invalid file:', unlinkError);
      }
      return res.status(400).json({ 
        error: 'File content does not match declared file type. File may be corrupted or malicious.' 
      });
    }

    // Check if community feature is enabled
    const config = await (prisma as any).clinicConfig.findFirst();
    if (config && !config.featureCommunityEnabled) {
      return res.status(403).json({ error: 'Community feature is disabled' });
    }

    const contentFilePath = `/uploads/content-files/${req.file.filename}`;
    
    // Log file upload
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.FILE_UPLOADED,
      resourceType: 'Content',
      resourceId: undefined,
      details: { fileName: req.file.originalname, fileSize: req.file.size, mimeType: req.file.mimetype },
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ filePath: contentFilePath, fileName: req.file.originalname, fileSize: req.file.size });
  } catch (error: any) {
    console.error('Upload content file error:', error);
    if (error.message && error.message.includes('File too large')) {
      res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
    } else {
      res.status(500).json({ error: 'Failed to upload content file' });
    }
  }
});

// Upload before/after images (patients: own showcase only; operators: with role + edit access)
router.post('/before-after', authenticateToken, multer({ storage: showcaseStorage }).fields([{ name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    if (!files.beforeImage || !files.afterImage) {
      return res.status(400).json({ error: 'Both before and after images required' });
    }

    // Get patientId from body (required for access check)
    const { patientId } = req.body;
    if (!patientId || typeof patientId !== 'string') {
      return res.status(400).json({ error: 'patientId is required and must be a string' });
    }

    // Allow patients to upload their own showcase images (no requireRole so they can reach this)
    // Operators need ADMIN/SUPPORT/BASIC and edit permission for the patient
    if (req.user.userType === 'PATIENT') {
      if (patientId !== req.user.id) {
        return res.status(403).json({ error: 'Patients can only upload their own showcase images' });
      }
    } else {
      const allowedRoles = ['ADMIN', 'SUPPORT', 'BASIC'];
      if (!req.user.role || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Operator access required' });
      }
      const hasAccess = await prisma.patientAccess.findUnique({
        where: {
          patientId_operatorId: {
            patientId,
            operatorId: req.user.id,
          },
        },
      });

      if (!hasAccess || !hasAccess.canEdit) {
        return res.status(403).json({ error: 'Edit permission required for this patient' });
      }
    }

    const beforeImagePath = `/uploads/showcase-images/${files.beforeImage[0].filename}`;
    const afterImagePath = `/uploads/showcase-images/${files.afterImage[0].filename}`;

    res.json({
      beforeImage: beforeImagePath,
      afterImage: afterImagePath,
    });
  } catch (error) {
    console.error('Upload before/after error:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// Upload message attachment (image)
router.post('/message', authenticateToken, multer({ storage: messageStorage }).single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if chat is enabled
    const config = await (prisma as any).clinicConfig.findFirst();
    if (config && !config.featureChatEnabled) {
      return res.status(403).json({ error: 'Chat is disabled' });
    }

    // SECURITY: Validate file content using magic bytes (not just MIME type)
    const messageAttachFullPath = path.join(messageAttachmentsDir, req.file.filename);
    if (!validateMagicBytes(messageAttachFullPath, req.file.mimetype)) {
      try {
        fs.unlinkSync(messageAttachFullPath);
      } catch (unlinkError) {
        console.error('[UPLOAD] Failed to delete invalid file:', unlinkError);
      }
      return res.status(400).json({ 
        error: 'File content does not match declared file type. File may be corrupted or malicious.' 
      });
    }

    const msgAttachPath = `/uploads/message-attachments/${req.file.filename}`;
    res.json({ 
      filePath: msgAttachPath,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (error) {
    console.error('Upload message attachment error:', error);
    res.status(500).json({ error: 'Failed to upload message attachment' });
  }
});

// Root route handler - provide helpful error message
router.get('/', (req, res) => {
  res.status(404).json({
    error: 'Invalid upload endpoint',
    message: 'Please use one of the following endpoints:',
    endpoints: [
      'POST /api/upload/session/:sessionId - Upload session file',
      'POST /api/upload/profile - Upload profile image',
      'POST /api/upload/content - Upload content file',
      'POST /api/upload/before-after - Upload before/after images',
      'POST /api/upload/message - Upload message attachment',
    ],
  });
});

export default router;


