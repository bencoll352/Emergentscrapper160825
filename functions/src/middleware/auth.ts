import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { ApiError } from '../types';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        email_verified?: boolean;
      };
    }
  }
}

export const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // In development, skip auth validation
    if (process.env.NODE_ENV === 'development') {
      console.log('Development mode: Skipping authentication');
      next();
      return;
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Authorization token required', 'UNAUTHORIZED');
    }

    // Extract token
    const token = authHeader.substring(7);

    try {
      // Verify Firebase ID token
      const decodedToken = await getAuth().verifyIdToken(token);
      
      // Add user info to request
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified
      };

      console.log(`Authenticated user: ${decodedToken.email || decodedToken.uid}`);
      next();
    } catch (authError) {
      console.error('Token verification failed:', authError);
      throw new ApiError(401, 'Invalid or expired token', 'INVALID_TOKEN');
    }

  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code
      });
    } else {
      console.error('Auth middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal authentication error',
        code: 'AUTH_ERROR'
      });
    }
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip in development
    if (process.env.NODE_ENV === 'development') {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without user info
      next();
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified
      };
    } catch (authError) {
      // Invalid token, but don't block the request
      console.warn('Optional auth failed:', authError);
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue even on error
  }
};