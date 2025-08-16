import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { ApiError } from '../types';

// Create rate limiter instance
const rateLimiter = new RateLimiterMemory({
  keyFunction: (req: Request) => {
    // Use IP address as key, with fallback
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // Number of requests
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000') / 1000, // Per 60 seconds
});

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await rateLimiter.consume(req.ip || 'unknown');
    next();
  } catch (rateLimiterRes: any) {
    // Calculate remaining time
    const remainingSeconds = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
    
    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': process.env.RATE_LIMIT_MAX_REQUESTS || '100',
      'X-RateLimit-Remaining': rateLimiterRes.remainingHits?.toString() || '0',
      'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
      'Retry-After': remainingSeconds.toString()
    });

    const error = new ApiError(
      429,
      `Too many requests. Try again in ${remainingSeconds} seconds.`,
      'RATE_LIMIT_EXCEEDED'
    );

    res.status(429).json({
      success: false,
      error: error.message,
      code: error.code,
      retryAfter: remainingSeconds
    });
  }
};

// Enhanced rate limiter for expensive operations
export const heavyOperationRateLimiter = new RateLimiterMemory({
  keyFunction: (req: Request) => req.ip || 'unknown',
  points: 10, // Much stricter limit for expensive operations
  duration: 60, // Per 60 seconds
});

export const heavyOperationMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await heavyOperationRateLimiter.consume(req.ip || 'unknown');
    next();
  } catch (rateLimiterRes: any) {
    const remainingSeconds = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
    
    res.set({
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': rateLimiterRes.remainingHits?.toString() || '0',
      'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
      'Retry-After': remainingSeconds.toString()
    });

    res.status(429).json({
      success: false,
      error: `Heavy operation rate limit exceeded. Try again in ${remainingSeconds} seconds.`,
      code: 'HEAVY_OPERATION_RATE_LIMIT_EXCEEDED',
      retryAfter: remainingSeconds
    });
  }
};