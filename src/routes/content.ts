import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
// @ts-ignore - AuditAction and UserType are enums that will be available after Prisma client regeneration
import { AuditAction, UserType } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { checkPatientAccess, checkCanEdit } from '../middleware/patientAccess';
import { auditLogger } from '../utils/auditLogger';
import { sendNotification, NotificationType } from '../utils/notificationHelper';

const router = express.Router();
const prisma = new PrismaClient();

// Get all content for operators (not just public)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Only operators can see all content
    if (req.user.userType !== 'OPERATOR') {
      return res.status(403).json({ error: 'Operator access required' });
    }

    const content = await prisma.content.findMany({
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ content });
  } catch (error) {
    console.error('Get content error:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Get public content
router.get('/public', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if community feature is enabled
    const config = await (prisma as any).clinicConfig.findFirst();
    if (config && !config.featureCommunityEnabled) {
      return res.status(403).json({ error: 'Community feature is disabled' });
    }

    const now = new Date();
    const content = await prisma.content.findMany({
      where: {
        isPublic: true,
        // Filter by publish date and expiration
        OR: [
          { publishDate: null },
          { publishDate: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: now } },
            ],
          },
        ],
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ content });
  } catch (error) {
    console.error('Get public content error:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Get assigned content only (for patient dashboard)
router.get('/assigned', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Patient access required' });
    }

    const patientId = req.user.id;

    // Get assigned content (filter by publish and expiry dates)
    const now = new Date();
    const assignedContent = await prisma.patientContent.findMany({
      where: {
        patientId,
        content: {
          OR: [
            { publishDate: null },
            { publishDate: { lte: now } },
          ],
          AND: [
            {
              OR: [
                { expiresAt: null },
                { expiresAt: { gte: now } },
              ],
            },
          ],
        },
      },
      include: {
        content: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const content = assignedContent.map(ac => ({
      ...ac.content,
      isViewed: !!ac.viewedAt,
      viewedAt: ac.viewedAt,
      patientContentId: ac.id, // Include patientContent id for viewing
    }));

    res.json({ content });
  } catch (error) {
    console.error('Get assigned content error:', error);
    res.status(500).json({ error: 'Failed to fetch assigned content' });
  }
});

// IMPORTANT: Specific routes must come BEFORE generic /:contentId route
// Otherwise Express will match /:contentId first and never reach /download or /stream

// Secure download endpoint for content files (PDFs, images, documents)
// Must be before /:contentId route
router.get('/:contentId/download', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { contentId } = req.params;
    const authHeader = req.headers.authorization;
    
    // Debug logging (development only)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[DOWNLOAD] Request received:', {
        contentId,
        userType: req.user?.userType,
        userId: req.user?.id,
        hasAuthHeader: !!authHeader,
          authHeaderPrefix: authHeader?.substring(0, 20) + '...',
      });
    }

    if (!req.user) {
      console.error('[DOWNLOAD] No user in request - authentication failed');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      console.error('[DOWNLOAD] Content not found:', contentId);
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check access permissions
    if (req.user.userType === 'PATIENT') {
      // Patients can only download public content OR assigned content
      if (!content.isPublic) {
        const assignment = await prisma.patientContent.findUnique({
          where: {
            patientId_contentId: {
              patientId: req.user.id,
              contentId: content.id,
            },
          },
        });

        if (!assignment) {
          console.error('[DOWNLOAD] Access denied - patient', req.user.id, 'does not have access to content', contentId);
          return res.status(403).json({ error: 'Access denied. This content is not available to you.' });
        }
        console.log('[DOWNLOAD] Patient', req.user.id, 'has assignment for content', contentId);
      } else {
        console.log('[DOWNLOAD] Patient', req.user.id, 'accessing public content', contentId);
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operators can download all content (they have access)
      console.log('[DOWNLOAD] Operator', req.user.id, 'accessing content', contentId);
    } else {
      console.error('[DOWNLOAD] Unknown user type:', req.user.userType);
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only allow download for specific content types (not videos - use streaming for those)
    if (content.contentType === 'VIDEO') {
      return res.status(400).json({ error: 'Videos should be streamed, not downloaded. Use the streaming endpoint.' });
    }

    if (!content.filePath) {
      return res.status(404).json({ error: 'File not found for this content' });
    }

    // Serve file securely
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(__dirname, '../../', content.filePath.replace(/^\//, ''));
    
    console.log('[DOWNLOAD] Resolved file path:', filePath);
    console.log('[DOWNLOAD] Original filePath from DB:', content.filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error('[DOWNLOAD] File does not exist at path:', filePath);
      return res.status(404).json({ error: 'File not found on server' });
    }

    const stat = fs.statSync(filePath);
    console.log('[DOWNLOAD] File exists, size:', stat.size, 'bytes');

    // Determine MIME type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const fileName = content.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ext;

    // Set headers for download
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache');
    
    console.log('[DOWNLOAD] Sending file:', fileName, 'Type:', mimeType, 'Size:', stat.size);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err: Error) => {
      console.error('[DOWNLOAD] File stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      }
    });
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download content error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Authenticated image endpoint for private images
router.get('/:contentId/image', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { contentId } = req.params;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (content.contentType !== 'IMAGE') {
      return res.status(400).json({ error: 'This endpoint is for images only' });
    }

    // Check access permissions
    if (req.user.userType === 'PATIENT') {
      if (!content.isPublic) {
        const assignment = await prisma.patientContent.findUnique({
          where: {
            patientId_contentId: {
              patientId: req.user.id,
              contentId: content.id,
            },
          },
        });

        if (!assignment) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }

    if (!content.filePath) {
      return res.status(404).json({ error: 'Image file not found' });
    }

    const fs = require('fs');
    const path = require('path');
    // Additional null check before using filePath
    if (!content.filePath || typeof content.filePath !== 'string') {
      return res.status(500).json({ error: 'Invalid file path' });
    }
    const filePath = path.resolve(__dirname, '../../', content.filePath.replace(/^\//, ''));
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image file not found on server' });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err: Error) => {
      console.error('[IMAGE] File stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read image' });
      }
    });
    fileStream.pipe(res);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Failed to load image' });
  }
});

// Video streaming endpoint with range request support
// Must be before /:contentId route
// Supports token in query parameter for react-native-video (which doesn't support custom headers)
router.get('/:contentId/stream', async (req: AuthRequest, res: Response) => {
  try {
    const { contentId } = req.params;
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token as string;
    const range = req.headers.range;
    
    // Authenticate from header OR query parameter (for react-native-video)
    let user = null;
    if (authHeader) {
      // Try header first
      const token = authHeader.split(' ')[1];
      if (token) {
        try {
          const jwt = require('jsonwebtoken');
          if (process.env.JWT_SECRET) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
            const foundUser = await prisma.user.findUnique({
              where: { id: decoded.id },
              select: { id: true, email: true, userType: true, role: true, isActive: true },
            });
            if (foundUser && foundUser.isActive) {
              user = {
                id: foundUser.id,
                email: foundUser.email,
                userType: foundUser.userType as 'PATIENT' | 'OPERATOR',
                role: foundUser.role || undefined,
              };
            }
          }
        } catch (err) {
          // Invalid token, continue to query param check
        }
      }
    }
    
    // If no user from header, try query parameter
    if (!user && tokenFromQuery) {
      try {
        const jwt = require('jsonwebtoken');
        if (process.env.JWT_SECRET) {
          const decoded = jwt.verify(tokenFromQuery, process.env.JWT_SECRET) as any;
          const foundUser = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, userType: true, role: true, isActive: true },
          });
          if (foundUser && foundUser.isActive) {
            user = {
              id: foundUser.id,
              email: foundUser.email,
              userType: foundUser.userType as 'PATIENT' | 'OPERATOR',
              role: foundUser.role || undefined,
            };
          }
        }
      } catch (err) {
        // Invalid token
      }
    }
    
    if (!user) {
      console.error('[STREAM] No valid authentication');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    req.user = user;
    
    // Debug logging (development only)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[STREAM] Request received:', {
        contentId,
        userType: req.user?.userType,
        userId: req.user?.id,
        hasAuthHeader: !!authHeader,
        hasTokenQuery: !!tokenFromQuery,
        hasRangeHeader: !!range,
        rangeHeader: range,
      });
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      console.error('[STREAM] Content not found:', contentId);
      return res.status(404).json({ error: 'Content not found' });
    }

    if (content.contentType !== 'VIDEO') {
      return res.status(400).json({ error: 'This endpoint is for video streaming only' });
    }

    // Check access permissions (same as download)
    if (req.user.userType === 'PATIENT') {
      if (!content.isPublic) {
        const assignment = await prisma.patientContent.findUnique({
          where: {
            patientId_contentId: {
              patientId: req.user.id,
              contentId: content.id,
            },
          },
        });

        if (!assignment) {
          console.error('[STREAM] Access denied - patient', req.user.id, 'does not have access to content', contentId);
          return res.status(403).json({ error: 'Access denied' });
        }
        console.log('[STREAM] Patient', req.user.id, 'has assignment for content', contentId);
      } else {
        console.log('[STREAM] Patient', req.user.id, 'accessing public content', contentId);
      }
    } else if (req.user.userType !== 'OPERATOR') {
      console.error('[STREAM] Unknown user type:', req.user.userType);
      return res.status(403).json({ error: 'Access denied' });
    }

    // For external URLs, redirect or proxy (simpler: redirect)
    if (content.url && typeof content.url === 'string' && (content.url.startsWith('http://') || content.url.startsWith('https://'))) {
      return res.redirect(content.url);
    }

    if (!content.filePath || typeof content.filePath !== 'string') {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(__dirname, '../../', content.filePath.replace(/^\//, ''));
    
    console.log('[STREAM] Resolved file path:', filePath);
    console.log('[STREAM] Original filePath from DB:', content.filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error('[STREAM] File does not exist at path:', filePath);
      return res.status(404).json({ error: 'Video file not found on server' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    console.log('[STREAM] File exists, size:', fileSize, 'bytes');

    // Determine MIME type
    const ext = path.extname(filePath).toLowerCase();
    const videoMimeTypes: { [key: string]: string } = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
    };
    const mimeType = videoMimeTypes[ext] || 'video/mp4';

    if (range) {
      // Handle range requests for video streaming
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      
      // Validate range
      if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= fileSize) {
        console.error('[STREAM] Invalid range:', range, 'File size:', fileSize);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).json({ error: 'Range Not Satisfiable' });
      }
      
      const chunksize = (end - start) + 1;
      console.log('[STREAM] Serving range:', start, '-', end, '(', chunksize, 'bytes)');
      
      const file = fs.createReadStream(filePath, { start, end });
      
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
      };
      
      res.writeHead(206, head);
      file.on('error', (err: Error) => {
        console.error('[STREAM] File stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream video' });
        }
      });
      file.pipe(res);
    } else {
      // Full video stream (not recommended for large files, but support it)
      console.log('[STREAM] No range header - serving full file');
      const head = {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      };
      
      res.writeHead(200, head);
      const file = fs.createReadStream(filePath);
      file.on('error', (err: Error) => {
        console.error('[STREAM] File stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream video' });
        }
      });
      file.pipe(res);
    }
  } catch (error) {
    console.error('Stream content error:', error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

// Get content for patient
router.get('/patient/:patientId', authenticateToken, checkPatientAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.params;
    
    // Check if community feature is enabled for public content
    const config = await prisma.clinicConfig.findFirst();
    const isCommunityEnabled = config ? config.featureCommunityEnabled : true;
    
    // Get public content and assigned content
    const [publicContent, assignedContent] = await Promise.all([
      isCommunityEnabled 
        ? (async () => {
            const now = new Date();
            return prisma.content.findMany({
              where: {
                isPublic: true,
                OR: [
                  { publishDate: null },
                  { publishDate: { lte: now } },
                ],
                AND: [
                  {
                    OR: [
                      { expiresAt: null },
                      { expiresAt: { gte: now } },
                    ],
                  },
                ],
              },
            include: {
              creator: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            });
          })()
        : Promise.resolve([]), // Return empty if community disabled
      prisma.patientContent.findMany({
        where: { patientId },
        include: {
          content: {
            include: {
              creator: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const allContent = [
      ...publicContent.map(c => ({ ...c, isViewed: false, viewedAt: null, patientContentId: null, isFavorite: false })),
      ...assignedContent.map(ac => ({
        ...ac.content,
        isViewed: !!ac.viewedAt,
        viewedAt: ac.viewedAt,
        isFavorite: ac.isFavorite || false,
        patientContentId: ac.id, // Include patientContent id for viewing
      })),
    ];

    res.json({ content: allContent });
  } catch (error) {
    console.error('Get patient content error:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Get content by ID
router.get('/:contentId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { contentId } = req.params;

    // Get content with creator information
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check if content is published and not expired (for patients only)
    if (req.user.userType === 'PATIENT') {
      const now = new Date();
      if (content.publishDate && content.publishDate > now) {
        return res.status(403).json({ error: 'Content not yet published' });
      }
      if (content.expiresAt && content.expiresAt < now) {
        return res.status(403).json({ error: 'Content has expired' });
      }
    }

    // Check access based on user type
    if (req.user.userType === 'PATIENT') {
      // Patients can access public content OR content assigned to them
      if (!content.isPublic) {
        // Check if content is assigned to this patient
        const assignment = await prisma.patientContent.findUnique({
          where: {
            patientId_contentId: {
              patientId: req.user.id,
              contentId: content.id,
            },
          },
        });

        if (!assignment) {
          return res.status(403).json({ error: 'Content not available. This content is not public and has not been assigned to you.' });
        }

        // Include viewing status for assigned content
        const contentWithStatus = {
          ...content,
          isViewed: !!assignment.viewedAt,
          viewedAt: assignment.viewedAt,
          isPersonalized: true,
          patientContentId: assignment.id, // Include for marking as viewed
        };

        return res.json({ content: contentWithStatus });
      } else {
        // Public content - check viewing status if assignment exists
        const assignment = await prisma.patientContent.findUnique({
          where: {
            patientId_contentId: {
              patientId: req.user.id,
              contentId: content.id,
            },
          },
        });

        const contentWithStatus = {
          ...content,
          isViewed: assignment ? !!assignment.viewedAt : false,
          viewedAt: assignment?.viewedAt || null,
          isPersonalized: !!assignment,
          patientContentId: assignment?.id || null, // Include if exists
        };

        return res.json({ content: contentWithStatus });
      }
    } else if (req.user.userType === 'OPERATOR') {
      // Operators can access all content
      // (ADMIN can also access all content)
      return res.json({ content });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Get content by ID error:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// Create content (ADMIN cannot create - only SUPPORT/operators can)
router.post(
  '/',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  [
    body('title').notEmpty(),
    body('contentType').isIn(['VIDEO', 'ARTICLE', 'IMAGE', 'DOCUMENT']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { title, description, contentType, filePath, url, thumbnail, isPublic, publishDate, expiresAt } = req.body;

      // Validate that content has either filePath or url
      if (!filePath && !url) {
        return res.status(400).json({ error: 'Content must have either filePath or url' });
      }

      // Validate content type matches source
      if (contentType === 'VIDEO' || contentType === 'IMAGE' || contentType === 'DOCUMENT') {
        if (!filePath && !url) {
          return res.status(400).json({ error: `${contentType} content requires a file or URL` });
        }
      }

      const content = await prisma.content.create({
        data: {
          title,
          description,
          contentType,
          filePath,
          url,
          thumbnail,
          isPublic: isPublic || false,
          createdBy: req.user.id,
          publishDate: publishDate ? new Date(publishDate) : null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.CREATE,
        resourceType: 'Content',
        resourceId: content.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.status(201).json({ content });
    } catch (error) {
      console.error('Create content error:', error);
      res.status(500).json({ error: 'Failed to create content' });
    }
  }
);

// Assign content to patient (ADMIN cannot assign - only SUPPORT/operators can)
router.post(
  '/:contentId/assign',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  checkCanEdit,
  [body('patientId').notEmpty()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { contentId } = req.params;
      const { patientId } = req.body;

      const patientContent = await prisma.patientContent.upsert({
        where: {
          patientId_contentId: {
            patientId,
            contentId,
          },
        },
        update: {},
        create: {
          patientId,
          contentId,
        },
      });

      // Send notification to patient about new content
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        select: { title: true, contentType: true },
      });

      if (content && req.user) {
        const operatorName = `${req.user.firstName} ${req.user.lastName}`;
        await sendNotification({
          userId: patientId,
          title: 'New Content Assigned',
          message: `${operatorName} assigned "${content.title}" for you`,
          type: NotificationType.CONTENT_ASSIGNED,
          data: { contentId, assignmentId: patientContent.id, contentType: content.contentType },
        });
      }

      res.json({ patientContent });
    } catch (error) {
      console.error('Assign content error:', error);
      res.status(500).json({ error: 'Failed to assign content' });
    }
  }
);

// Unassign content from patient (SUPPORT and ADMIN can unassign)
router.delete(
  '/:contentId/assign/:patientId',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  checkCanEdit,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { contentId, patientId } = req.params;

      // Check if assignment exists
      const assignment = await prisma.patientContent.findUnique({
        where: {
          patientId_contentId: {
            patientId,
            contentId,
          },
        },
      });

      if (!assignment) {
        return res.status(404).json({ error: 'Content assignment not found' });
      }

      // Delete the assignment
      await prisma.patientContent.delete({
        where: {
          patientId_contentId: {
            patientId,
            contentId,
          },
        },
      });

      // Log audit
      await auditLogger.log({
        userId: req.user.id,
        userType: req.user.userType as UserType,
        action: AuditAction.DELETE,
        resourceType: 'PatientContent',
        resourceId: assignment.id,
        details: { contentId, patientId },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      });

      res.json({ message: 'Content assignment removed successfully' });
    } catch (error) {
      console.error('Unassign content error:', error);
      res.status(500).json({ error: 'Failed to unassign content' });
    }
  }
);

// Mark content as viewed (workflow format: PATCH /patient-content/:id/viewed)
router.patch('/patient-content/:id/viewed', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Only patients can mark content as viewed' });
    }

    const { id: patientContentId } = req.params;
    const patientId = req.user.id;

    // Find patientContent by id
    const patientContent = await prisma.patientContent.findUnique({
      where: { id: patientContentId },
      include: {
        content: true,
      },
    });

    if (!patientContent) {
      return res.status(404).json({ error: 'Patient content assignment not found' });
    }

    // Verify it belongs to the current patient
    if (patientContent.patientId !== patientId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update viewedAt and increment view count
    const wasAlreadyViewed = !!patientContent.viewedAt;
    const updated = await prisma.patientContent.update({
      where: { id: patientContentId },
      data: {
        viewedAt: new Date(),
      },
      include: {
        content: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Increment view count only if not already viewed
    if (!wasAlreadyViewed) {
      await prisma.content.update({
        where: { id: patientContent.contentId },
        data: {
          viewCount: {
            increment: 1,
          },
        },
      });
    }

    res.json({ patientContent: updated });
  } catch (error) {
    console.error('Mark viewed error:', error);
    res.status(500).json({ error: 'Failed to mark as viewed' });
  }
});

// Toggle favorite status for content
router.patch('/patient-content/:id/favorite', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Only patients can favorite content' });
    }

    const { id: patientContentId } = req.params;
    const patientId = req.user.id;

    const patientContent = await prisma.patientContent.findUnique({
      where: { id: patientContentId },
    });

    if (!patientContent || patientContent.patientId !== patientId) {
      return res.status(404).json({ error: 'Patient content assignment not found' });
    }

    const updated = await prisma.patientContent.update({
      where: { id: patientContentId },
      data: {
        isFavorite: !patientContent.isFavorite,
      },
      include: {
        content: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    res.json({ patientContent: updated });
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Mark content as viewed (backward compatibility - using contentId)
router.put('/:contentId/view', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'PATIENT') {
      return res.status(403).json({ error: 'Only patients can mark content as viewed' });
    }

    const { contentId } = req.params;
    const patientId = req.user.id;

    // Check if content is assigned to patient or is public
    const content = await prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (!content.isPublic) {
      const assignment = await prisma.patientContent.findUnique({
        where: {
          patientId_contentId: {
            patientId,
            contentId,
          },
        },
      });

      if (!assignment) {
        return res.status(403).json({ error: 'Content not assigned to patient' });
      }
    }

    // Check if already viewed
    const existing = await prisma.patientContent.findUnique({
      where: {
        patientId_contentId: {
          patientId,
          contentId,
        },
      },
    });

    const wasAlreadyViewed = existing?.viewedAt !== null && existing?.viewedAt !== undefined;

    const patientContent = await prisma.patientContent.upsert({
      where: {
        patientId_contentId: {
          patientId,
          contentId,
        },
      },
      update: {
        viewedAt: new Date(),
      },
      create: {
        patientId,
        contentId,
        viewedAt: new Date(),
      },
    });

    // Increment view count only if not already viewed
    if (!wasAlreadyViewed) {
      await prisma.content.update({
        where: { id: contentId },
        data: {
          viewCount: {
            increment: 1,
          },
        },
      });
    }

    res.json({ patientContent });
  } catch (error) {
    console.error('Mark viewed error:', error);
    res.status(500).json({ error: 'Failed to mark as viewed' });
  }
});

// Update content
// Note: Content is not patient-specific, so checkCanEdit is not needed
router.put('/:contentId', authenticateToken, requireRole('ADMIN', 'SUPPORT', 'BASIC'), async (req: AuthRequest, res: Response) => {
  try {
    const { contentId } = req.params;
    const { title, description, filePath, url, thumbnail, isPublic, publishDate, expiresAt } = req.body;

    // Validate required fields
    if (!contentId) {
      return res.status(400).json({ error: 'Content ID is required' });
    }
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      return res.status(400).json({ error: 'Title must be a non-empty string' });
    }
    if (filePath !== undefined && filePath !== null && typeof filePath !== 'string') {
      return res.status(400).json({ error: 'File path must be a string' });
    }
    if (url !== undefined && url !== null && typeof url !== 'string') {
      return res.status(400).json({ error: 'URL must be a string' });
    }

      const content = await prisma.content.update({
        where: { id: contentId },
        data: {
          title,
          description,
          filePath,
          url,
          thumbnail,
          isPublic,
          publishDate: publishDate ? new Date(publishDate) : null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      // Log audit
      if (req.user) {
        await auditLogger.log({
          userId: req.user.id,
          userType: req.user.userType as UserType,
          action: AuditAction.UPDATE,
          resourceType: 'Content',
          resourceId: contentId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
          userAgent: req.headers['user-agent'] || undefined,
        });
      }

      res.json({ content });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Delete content (admin only)
router.delete('/:contentId', authenticateToken, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { contentId } = req.params;
    await prisma.content.delete({ where: { id: contentId } });
    
    // Log audit
    await auditLogger.log({
      userId: req.user.id,
      userType: req.user.userType as UserType,
      action: AuditAction.DELETE,
      resourceType: 'Content',
      resourceId: contentId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      userAgent: req.headers['user-agent'] || undefined,
    });

    res.json({ message: 'Content deleted' });
  } catch (error) {
    console.error('Delete content error:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});


// Create content recommendation
router.post(
  '/recommendations',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  [
    body('patientId').notEmpty(),
    body('contentId').notEmpty(),
    body('reason').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { patientId, contentId, reason } = req.body;

      // Check if content exists
      const content = await prisma.content.findUnique({ where: { id: contentId } });
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }

      // Create recommendation
      const recommendation = await (prisma as any).contentRecommendation.create({
        data: {
          patientId,
          contentId,
          recommendedBy: req.user.id,
          reason,
        },
        include: {
          content: true,
        },
      });

      // Send notification
      if (req.user.firstName && req.user.lastName) {
        const recommenderName = `${req.user.firstName} ${req.user.lastName}`;
        await sendNotification({
          userId: patientId,
          title: 'Content Recommended',
          message: `${recommenderName} recommended "${content.title}" for you`,
          type: NotificationType.CONTENT_RECOMMENDED,
          data: { contentId, recommendationId: recommendation.id },
        });
      }

      res.status(201).json({ recommendation });
    } catch (error) {
      console.error('Create recommendation error:', error);
      res.status(500).json({ error: 'Failed to create recommendation' });
    }
  }
);

// Get recommendations for patient
router.get(
  '/recommendations/:patientId',
  authenticateToken,
  checkPatientAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const { patientId } = req.params;

      const recommendations = await (prisma as any).contentRecommendation.findMany({
        where: { patientId },
        include: {
          content: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ recommendations });
    } catch (error) {
      console.error('Get recommendations error:', error);
      res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
  }
);

// Delete recommendation
router.delete(
  '/recommendations/:recommendationId',
  authenticateToken,
  requireRole('ADMIN', 'SUPPORT', 'BASIC'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { recommendationId } = req.params;

      await prisma.contentRecommendation.delete({
        where: { id: recommendationId },
      });

      res.json({ message: 'Recommendation deleted' });
    } catch (error) {
      console.error('Delete recommendation error:', error);
      res.status(500).json({ error: 'Failed to delete recommendation' });
    }
  }
);

export default router;


