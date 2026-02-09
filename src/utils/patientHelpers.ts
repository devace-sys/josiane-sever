/**
 * Utility functions for patient data transformation
 * Ensures consistent data structure across all API endpoints
 */

/**
 * Flattens patient data structure by merging user fields into patient object
 * This ensures frontend receives a consistent flat structure instead of nested user object
 * 
 * @param patient - Patient object with nested user relation
 * @returns Flattened patient object with all user fields at root level
 */
export function flattenPatientData(patient: any) {
  if (!patient) return null;
  
  const { user, ...patientData } = patient;
  
  // Determine active status: only active if logged in within last 30 days (never treat never-logged-in as active)
  const lastLoginAt = user?.lastLoginAt ? new Date(user.lastLoginAt) : null;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const isActuallyActive = lastLoginAt ? (lastLoginAt >= thirtyDaysAgo && user?.isActive !== false) : false;

  return {
    ...patientData,
    // User fields
    email: user?.email || patientData.email,
    firstName: user?.firstName || patientData.firstName,
    lastName: user?.lastName || patientData.lastName,
    phone: user?.phone || patientData.phone,
    profileImage: user?.profileImage || patientData.profileImage,
    userType: user?.userType || patientData.userType,
    role: user?.role || patientData.role,
    isActive: isActuallyActive,
    lastLoginAt: user?.lastLoginAt || null,
    // Online status fields
    isOnline: user?.isOnline ?? false,
    lastSeenAt: user?.lastSeenAt || null,
    // Timestamps - prefer user timestamps as they're the source of truth
    createdAt: user?.createdAt || patientData.createdAt,
    updatedAt: user?.updatedAt || patientData.updatedAt,
  };
}

/**
 * Flattens an array of patient objects
 * 
 * @param patients - Array of patient objects with nested user relations
 * @returns Array of flattened patient objects
 */
export function flattenPatientArray(patients: any[]): any[] {
  return patients.map(flattenPatientData).filter(Boolean);
}

/**
 * Flattens a User (with patientProfile and patientAccessesAsPatient) into patient detail + accesses for GET by id
 */
export function flattenPatientDetailFromUser(user: any): any {
  if (!user || user.userType !== 'PATIENT') return null;
  const profile = user.patientProfile || {};
  const lastLoginAt = user.lastLoginAt ? new Date(user.lastLoginAt) : null;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const isActuallyActive = lastLoginAt ? (lastLoginAt >= thirtyDaysAgo && user.isActive !== false) : false;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    profileImage: user.profileImage,
    userType: user.userType,
    role: user.role,
    isActive: isActuallyActive,
    lastLoginAt: user.lastLoginAt || null,
    // Online status fields
    isOnline: user.isOnline ?? false,
    lastSeenAt: user.lastSeenAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    dateOfBirth: profile.dateOfBirth || null,
    isInTreatment: profile.isInTreatment ?? true,
    medicalHistory: profile.medicalHistory || null,
    allergies: profile.allergies || null,
    medications: profile.medications || null,
    previousTreatments: profile.previousTreatments || null,
    notes: profile.notes || null,
    accesses: (user.patientAccessesAsPatient || []).map((a: any) => ({
      id: a.id,
      patientId: a.patientId,
      operatorId: a.operatorId,
      canView: a.canView,
      canEdit: a.canEdit,
      createdAt: a.createdAt,
      operator: a.operator,
    })),
  };
}

