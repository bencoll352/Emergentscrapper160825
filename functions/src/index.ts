import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { initializeApp } from 'firebase-admin/app';
import { searchBusinessesHandler } from './handlers/searchBusinesses';
import { companiesHouseHandler } from './handlers/companiesHouse';
import { cachedBusinessesHandler } from './handlers/cachedBusinesses';
import { healthCheckHandler } from './handlers/healthCheck';
import { rateLimitMiddleware } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { validateApiKey } from './middleware/auth';

// Initialize Firebase Admin
initializeApp();

const app = express();

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.use(cors({ 
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-domain.web.app', 'https://your-domain.firebaseapp.com']
    : true,
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting
app.use(rateLimitMiddleware);

// Health check endpoint
app.get('/health', healthCheckHandler);

// API Routes with validation
app.post('/search-businesses', validateApiKey, searchBusinessesHandler);
app.get('/cached-businesses', validateApiKey, cachedBusinessesHandler);
app.get('/company/:companyNumber', validateApiKey, companiesHouseHandler);
app.get('/search/companies', validateApiKey, companiesHouseHandler);

// Error handling middleware
app.use(errorHandler);

// Export the main API function
export const api = functions
  .region('europe-west2') // UK region for better latency
  .runWith({
    memory: '2GB',
    timeoutSeconds: 540,
    minInstances: 1, // Keep warm for better performance
    maxInstances: 100
  })
  .https
  .onRequest(app);

// Background function for data cleanup
export const cleanupOldData = functions
  .region('europe-west2')
  .pubsub
  .schedule('0 2 * * *') // Run daily at 2 AM
  .timeZone('Europe/London')
  .onRun(async (context) => {
    const { DatabaseService } = await import('./services/database');
    const db = new DatabaseService();
    
    try {
      await db.cleanupExpiredData();
      console.log('Data cleanup completed successfully');
      return null;
    } catch (error) {
      console.error('Data cleanup failed:', error);
      throw error;
    }
  });

// Background function for warming up cache
export const warmupCache = functions
  .region('europe-west2')
  .pubsub
  .schedule('0 8 * * 1-5') // Weekdays at 8 AM
  .timeZone('Europe/London')
  .onRun(async (context) => {
    const { CacheService } = await import('./services/cache');
    const cache = new CacheService();
    
    try {
      await cache.warmupPopularSearches();
      console.log('Cache warmup completed successfully');
      return null;
    } catch (error) {
      console.error('Cache warmup failed:', error);
      throw error;
    }
  });