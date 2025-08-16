import { Request, Response, NextFunction } from 'express';
import { ApiError, ValidationError, ExternalApiError } from '../types';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // Handle specific error types
  if (error instanceof ValidationError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (error instanceof ExternalApiError) {
    res.status(error.statusCode).json({
      success: false,
      error: `External service error: ${error.message}`,
      code: error.code,
      service: error.service,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle MongoDB errors
  if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    res.status(503).json({
      success: false,
      error: 'Database service unavailable',
      code: 'DATABASE_ERROR',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle timeout errors
  if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
    res.status(408).json({
      success: false,
      error: 'Request timeout',
      code: 'TIMEOUT_ERROR',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle JSON parsing errors
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      code: 'INVALID_JSON',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Default error response
  const statusCode = process.env.NODE_ENV === 'production' ? 500 : 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
  });
};

// Async error wrapper to catch promise rejections
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`,
    code: 'NOT_FOUND',
    timestamp: new Date().toISOString()
  });
};