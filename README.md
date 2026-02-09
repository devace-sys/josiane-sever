# Healthcare App - Backend API

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. Set up database:
```bash
npx prisma migrate dev
npx prisma generate
```

4. Start development server:
```bash
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/register-operator` - Register operator
- `POST /api/auth/register-patient` - Register patient
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Patients
- `GET /api/patients` - Get all patients (operators only)
- `GET /api/patients/:patientId` - Get patient by ID
- `POST /api/patients` - Create patient (operators only)
- `PUT /api/patients/:patientId` - Update patient
- `POST /api/patients/:patientId/access` - Grant/revoke access (admin only)

### Sessions
- `GET /api/sessions/patient/:patientId` - Get sessions for patient
- `GET /api/sessions/:sessionId` - Get session by ID
- `POST /api/sessions` - Create session
- `PUT /api/sessions/:sessionId` - Update session
- `POST /api/sessions/:sessionId/instructions` - Add instruction
- `DELETE /api/sessions/:sessionId` - Delete session (admin only)

### Messages
- `GET /api/messages/patient/:patientId` - Get messages for patient
- `POST /api/messages` - Send message
- `PUT /api/messages/:messageId/read` - Mark as read
- `PUT /api/messages/patient/:patientId/read-all` - Mark all as read

### Content
- `GET /api/content/public` - Get public content
- `GET /api/content/patient/:patientId` - Get content for patient
- `POST /api/content` - Create content (operators only)
- `POST /api/content/:contentId/assign` - Assign content to patient
- `PUT /api/content/:contentId/view` - Mark as viewed
- `PUT /api/content/:contentId` - Update content
- `DELETE /api/content/:contentId` - Delete content (admin only)

### Checklists
- `GET /api/checklists/patient/:patientId` - Get checklists for patient
- `GET /api/checklists/:checklistId` - Get checklist by ID
- `POST /api/checklists` - Create checklist
- `PUT /api/checklists/:checklistId` - Update checklist
- `DELETE /api/checklists/:checklistId` - Delete checklist (admin only)

### Before/After
- `GET /api/before-after/patient/:patientId` - Get before/after photos
- `GET /api/before-after/:beforeAfterId` - Get by ID
- `POST /api/before-after` - Create before/after
- `PUT /api/before-after/:beforeAfterId` - Update
- `DELETE /api/before-after/:beforeAfterId` - Delete (admin only)

### Upload
- `POST /api/upload/session/:sessionId` - Upload file for session
- `POST /api/upload/profile` - Upload profile image
- `POST /api/upload/content` - Upload content file
- `POST /api/upload/before-after` - Upload before/after images

## Authentication

All endpoints except `/api/auth/*` require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Permissions

- **ADMIN**: Full access to all patients and operations
- **SUPPORT**: Can create/edit but cannot delete
- **BASIC**: Can only interact with patients (view/send messages)
- **PATIENT**: Can only access their own data



