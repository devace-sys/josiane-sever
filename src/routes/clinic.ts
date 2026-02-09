import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Get clinic configuration (requires authentication)
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    let config = await prisma.clinicConfig.findFirst();

    // If no config exists, return defaults
    if (!config) {
      config = await prisma.clinicConfig.create({
        data: {
          clinicName: 'Healthcare Clinic',
          supportEmail: 'support@clinic.com',
          supportPhone: '+1234567890',
          featureChatEnabled: true,
          featurePatientUploadsEnabled: true,
          featureCommunityEnabled: true,
        },
      });
    }

    res.json({ config });
  } catch (error) {
    console.error('Get clinic config error:', error);
    res.status(500).json({ error: 'Failed to fetch clinic configuration' });
  }
});

// Update clinic configuration (admin only)
router.put(
  '/',
  authenticateToken,
  requireRole('ADMIN'),
  [
    body('clinicName').optional().notEmpty(),
    body('primaryColor').optional().isString(),
    body('secondaryColor').optional().isString(),
    body('backgroundColor').optional().isString(),
    body('surfaceColor').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        clinicName,
        logo,
        primaryColor,
        secondaryColor,
        backgroundColor,
        surfaceColor,
        termsOfService,
        privacyPolicy,
        supportEmail,
        supportPhone,
        featureChatEnabled,
        featurePatientUploadsEnabled,
        featureCommunityEnabled,
      } = req.body;

      let config = await prisma.clinicConfig.findFirst();

      if (!config) {
        config = await prisma.clinicConfig.create({
          data: {
            clinicName: clinicName || 'Healthcare Clinic',
            logo,
            primaryColor,
            secondaryColor,
            backgroundColor,
            surfaceColor,
            termsOfService,
            privacyPolicy,
            supportEmail: supportEmail || 'support@clinic.com',
            supportPhone: supportPhone || '+1234567890',
            featureChatEnabled: featureChatEnabled !== undefined ? featureChatEnabled : true,
            featurePatientUploadsEnabled: featurePatientUploadsEnabled !== undefined ? featurePatientUploadsEnabled : true,
            featureCommunityEnabled: featureCommunityEnabled !== undefined ? featureCommunityEnabled : true,
          },
        });
      } else {
        if (!config || !config.id) {
          return res.status(500).json({ error: 'Invalid clinic configuration' });
        }
        config = await prisma.clinicConfig.update({
          where: { id: config.id },
          data: {
            ...(clinicName && { clinicName }),
            ...(logo !== undefined && { logo }),
            ...(primaryColor !== undefined && { primaryColor }),
            ...(secondaryColor !== undefined && { secondaryColor }),
            ...(backgroundColor !== undefined && { backgroundColor }),
            ...(surfaceColor !== undefined && { surfaceColor }),
            ...(termsOfService !== undefined && { termsOfService }),
            ...(privacyPolicy !== undefined && { privacyPolicy }),
            ...(supportEmail !== undefined && { supportEmail }),
            ...(supportPhone !== undefined && { supportPhone }),
            ...(featureChatEnabled !== undefined && { featureChatEnabled }),
            ...(featurePatientUploadsEnabled !== undefined && { featurePatientUploadsEnabled }),
            ...(featureCommunityEnabled !== undefined && { featureCommunityEnabled }),
          },
        });
      }

      res.json({ config });
    } catch (error) {
      console.error('Update clinic config error:', error);
      res.status(500).json({ error: 'Failed to update clinic configuration' });
    }
  }
);

export default router;

