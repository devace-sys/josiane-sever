import nodemailer from 'nodemailer';

// Email service for sending emails
// Configure with environment variables or use a test account
const createTransporter = () => {
  // In production, use real SMTP settings from environment variables
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  
  if (smtpHost && smtpUser && smtpPass) {
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    if (isNaN(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      console.warn('Invalid SMTP_PORT, using default 587');
    }
    
    return nodemailer.createTransport({
      host: smtpHost,
      port: isNaN(smtpPort) ? 587 : smtpPort,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  }

  // In development, use a test account (ethereal.email) or console log
  if (process.env.NODE_ENV === 'development') {
    // For development, we can use ethereal.email or just log
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.ETHEREAL_USER || 'test@ethereal.email',
        pass: process.env.ETHEREAL_PASS || 'test',
      },
    });
  }

  // Fallback: create a test transporter that logs emails
  return nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
};

// Email template with professional styling
const getEmailTemplate = (content: string, title: string) => {
  const appName = process.env.APP_NAME || 'HealthCare App';
  const primaryColor = process.env.EMAIL_PRIMARY_COLOR || '#6200EA';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="background-color: ${primaryColor}; padding: 30px 40px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${appName}</h1>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 40px;">
                  ${content}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f9f9f9; padding: 20px 40px; text-align: center; border-top: 1px solid #e0e0e0;">
                  <p style="margin: 0; color: #666; font-size: 12px; line-height: 1.6;">
                    This is an automated message from ${appName}.<br>
                    Please do not reply to this email.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

// Log email in development mode
const logEmailDevelopment = (type: string, to: string, data: any) => {
  if (process.env.NODE_ENV === 'development' && !process.env.SMTP_HOST) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📧 ${type.toUpperCase()} EMAIL (Development)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`To: ${to}`);
    Object.entries(data).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
    console.log(`${'='.repeat(60)}\n`);
    return true;
  }
  return false;
};

export const emailService = {
  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string, userType: string) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}&userType=${userType}`;

      if (logEmailDevelopment('Password Reset', email, { resetUrl, token: resetToken, userType })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">Password Reset Request</h2>
        <p style="color: #666; line-height: 1.6;">You requested to reset your password. Click the button below to reset it:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #6200EA; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Reset Password</a>
        </div>
        <p style="color: #666; line-height: 1.6; font-size: 14px;">Or copy and paste this link into your browser:</p>
        <p style="color: #6200EA; word-break: break-all; font-size: 12px;">${resetUrl}</p>
        <p style="color: #999; line-height: 1.6; margin-top: 30px; font-size: 14px;"><strong>This link will expire in 1 hour.</strong></p>
        <p style="color: #999; line-height: 1.6; font-size: 14px;">If you didn't request this, please ignore this email and your password will remain unchanged.</p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: 'Password Reset Request',
        html: getEmailTemplate(htmlContent, 'Password Reset Request'),
        text: `Password Reset Request\n\nYou requested to reset your password. Visit the following link to reset it:\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw error;
    }
  },

  /**
   * Send welcome email to new operator
   */
  async sendOperatorWelcomeEmail(
    email: string,
    firstName: string,
    tempPassword: string,
    inviteToken: string,
    role: string
  ) {
    try {
      const setupUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/setup-account?token=${inviteToken}`;

      if (logEmailDevelopment('Operator Welcome', email, { setupUrl, tempPassword, role })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">Welcome to the Team, ${firstName}!</h2>
        <p style="color: #666; line-height: 1.6;">Your account has been created as a <strong>${role}</strong>. Please use the credentials below to get started:</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 4px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; color: #333;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 0; color: #333;"><strong>Temporary Password:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; color: #6200EA;">${tempPassword}</code></p>
        </div>

        <p style="color: #666; line-height: 1.6;">For security, you'll be required to change your password on first login.</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${setupUrl}" style="background-color: #6200EA; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Set Up Your Account</a>
        </div>

        <p style="color: #999; line-height: 1.6; font-size: 14px; margin-top: 30px;"><strong>This setup link will expire in 7 days.</strong></p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: `Welcome to ${process.env.APP_NAME || 'HealthCare App'}`,
        html: getEmailTemplate(htmlContent, 'Welcome'),
        text: `Welcome to ${process.env.APP_NAME || 'HealthCare App'}, ${firstName}!\n\nYour account has been created as a ${role}.\n\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nSetup Link: ${setupUrl}\n\nYou'll be required to change your password on first login.\n\nThis link will expire in 7 days.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send operator welcome email:', error);
      throw error;
    }
  },

  /**
   * Send welcome email to new patient
   */
  async sendPatientWelcomeEmail(
    email: string,
    firstName: string,
    tempPassword: string,
    inviteToken: string
  ) {
    try {
      const setupUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/setup-account?token=${inviteToken}`;

      if (logEmailDevelopment('Patient Welcome', email, { setupUrl, tempPassword })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">Welcome, ${firstName}!</h2>
        <p style="color: #666; line-height: 1.6;">Your patient account has been created. We're excited to support you on your journey!</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 4px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; color: #333;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 0; color: #333;"><strong>Temporary Password:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; color: #6200EA;">${tempPassword}</code></p>
        </div>

        <p style="color: #666; line-height: 1.6;">For your security, you'll be required to change your password on first login.</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${setupUrl}" style="background-color: #6200EA; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Get Started</a>
        </div>

        <p style="color: #666; line-height: 1.6; font-size: 14px; margin-top: 30px;"><strong>What's Next?</strong></p>
        <ul style="color: #666; line-height: 1.8; font-size: 14px;">
          <li>Complete your profile</li>
          <li>Upload any required documents</li>
          <li>Connect with your care team</li>
        </ul>

        <p style="color: #999; line-height: 1.6; font-size: 14px; margin-top: 30px;"><strong>This setup link will expire in 7 days.</strong></p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: `Welcome to ${process.env.APP_NAME || 'HealthCare App'}`,
        html: getEmailTemplate(htmlContent, 'Welcome'),
        text: `Welcome to ${process.env.APP_NAME || 'HealthCare App'}, ${firstName}!\n\nYour patient account has been created.\n\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nSetup Link: ${setupUrl}\n\nYou'll be required to change your password on first login.\n\nThis link will expire in 7 days.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send patient welcome email:', error);
      throw error;
    }
  },

  /**
   * Send session reminder email
   */
  async sendSessionReminderEmail(
    email: string,
    firstName: string,
    sessionTitle: string,
    sessionDate: Date,
    sessionType: string
  ) {
    try {
      const dateStr = sessionDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const timeStr = sessionDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (logEmailDevelopment('Session Reminder', email, { sessionTitle, sessionDate: `${dateStr} at ${timeStr}`, sessionType })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">Session Reminder</h2>
        <p style="color: #666; line-height: 1.6;">Hi ${firstName},</p>
        <p style="color: #666; line-height: 1.6;">This is a friendly reminder about your upcoming session:</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #6200EA;">
          <p style="margin: 0 0 10px 0; color: #333; font-size: 18px; font-weight: 500;">${sessionTitle}</p>
          <p style="margin: 0 0 5px 0; color: #666;"><strong>Date:</strong> ${dateStr}</p>
          <p style="margin: 0 0 5px 0; color: #666;"><strong>Time:</strong> ${timeStr}</p>
          <p style="margin: 0; color: #666;"><strong>Type:</strong> ${sessionType}</p>
        </div>

        <p style="color: #666; line-height: 1.6;">Please make sure you're prepared and on time.</p>
        <p style="color: #999; line-height: 1.6; font-size: 14px; margin-top: 30px;">If you need to reschedule, please contact your care team as soon as possible.</p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: `Session Reminder: ${sessionTitle}`,
        html: getEmailTemplate(htmlContent, 'Session Reminder'),
        text: `Session Reminder\n\nHi ${firstName},\n\nThis is a reminder about your upcoming session:\n\n${sessionTitle}\nDate: ${dateStr}\nTime: ${timeStr}\nType: ${sessionType}\n\nPlease make sure you're prepared and on time.\n\nIf you need to reschedule, please contact your care team.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send session reminder email:', error);
      throw error;
    }
  },

  /**
   * Send account activation confirmation
   */
  async sendAccountActivationEmail(email: string, firstName: string, userType: string) {
    try {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

      if (logEmailDevelopment('Account Activation', email, { userType, loginUrl })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">Account Activated! 🎉</h2>
        <p style="color: #666; line-height: 1.6;">Hi ${firstName},</p>
        <p style="color: #666; line-height: 1.6;">Great news! Your account has been successfully activated and you're all set to go.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="background-color: #6200EA; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Login Now</a>
        </div>

        <p style="color: #666; line-height: 1.6;">You can now access all features of your ${userType.toLowerCase()} account.</p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: 'Your Account is Activated',
        html: getEmailTemplate(htmlContent, 'Account Activated'),
        text: `Account Activated!\n\nHi ${firstName},\n\nYour account has been successfully activated!\n\nLogin URL: ${loginUrl}\n\nYou can now access all features of your ${userType.toLowerCase()} account.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send account activation email:', error);
      throw error;
    }
  },

  /**
   * Send invite token regeneration email
   */
  async sendInviteTokenRegeneratedEmail(
    email: string,
    firstName: string,
    inviteToken: string,
    userType: string
  ) {
    try {
      const setupUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/setup-account?token=${inviteToken}`;

      if (logEmailDevelopment('Invite Token Regenerated', email, { setupUrl, userType })) {
        return { messageId: 'dev-logged' };
      }

      const htmlContent = `
        <h2 style="color: #333; margin-top: 0;">New Setup Link Generated</h2>
        <p style="color: #666; line-height: 1.6;">Hi ${firstName},</p>
        <p style="color: #666; line-height: 1.6;">A new account setup link has been generated for you. Your previous link has been expired.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${setupUrl}" style="background-color: #6200EA; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Set Up Your Account</a>
        </div>

        <p style="color: #999; line-height: 1.6; font-size: 14px; margin-top: 30px;"><strong>This link will expire in 7 days.</strong></p>
        <p style="color: #999; line-height: 1.6; font-size: 14px;">If you didn't request this, please contact support immediately.</p>
      `;

      const transporter = createTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@healthcareapp.com',
        to: email,
        subject: 'New Account Setup Link',
        html: getEmailTemplate(htmlContent, 'New Setup Link'),
        text: `New Setup Link Generated\n\nHi ${firstName},\n\nA new account setup link has been generated for you.\n\nSetup URL: ${setupUrl}\n\nThis link will expire in 7 days.\n\nIf you didn't request this, please contact support immediately.`,
      });

      return info;
    } catch (error) {
      console.error('Failed to send invite token regenerated email:', error);
      throw error;
    }
  },
};

