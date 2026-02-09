declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        userType: 'PATIENT' | 'OPERATOR';
        role?: string;
        firstName?: string | null;
        lastName?: string | null;
      };
    }
  }
}

export {};
