import { Request, Response } from 'express';
import { DatabaseService } from '../services/database';
import { CacheService } from '../services/cache';
import { GooglePlacesService } from '../services/googlePlaces';
import { CompaniesHouseService } from '../services/companiesHouse';

export const healthCheckHandler = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'unknown',
    services: {
      database: { status: 'unknown', responseTime: 0 },
      cache: { status: 'unknown', responseTime: 0 },
      googlePlaces: { status: 'unknown', responseTime: 0 },
      companiesHouse: { status: 'unknown', responseTime: 0 }
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    }
  };

  // Test database connection
  try {
    const dbStart = Date.now();
    const database = new DatabaseService();
    await database.connect();
    
    // Simple ping test
    const stats = await database.getBusinessStats();
    
    health.services.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStart,
      totalBusinesses: stats.total,
      verifiedBusinesses: stats.verified
    };
  } catch (error) {
    health.services.database = {
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: error.message
    };
    health.status = 'degraded';
  }

  // Test cache service
  try {
    const cacheStart = Date.now();
    const cache = new CacheService();
    
    // Test cache operations
    const testKey = 'health_check_test';
    const testValue = { timestamp: Date.now() };
    
    cache.setMultipleBusinesses([]);
    const stats = cache.getStats();
    
    health.services.cache = {
      status: 'healthy',
      responseTime: Date.now() - cacheStart,
      stats: stats
    };
  } catch (error) {
    health.services.cache = {
      status: 'unhealthy',
      responseTime: Date.now() - cacheStart,
      error: error.message
    };
    health.status = 'degraded';
  }

  // Test Google Places API (light test)
  try {
    const googleStart = Date.now();
    const googlePlaces = new GooglePlacesService();
    
    // Test with known postcode
    await googlePlaces.convertPostcodeToCoordinates('SW1A 1AA');
    
    const rateLimiterStats = googlePlaces.getRateLimiterStats();
    
    health.services.googlePlaces = {
      status: 'healthy',
      responseTime: Date.now() - googleStart,
      rateLimiter: rateLimiterStats
    };
  } catch (error) {
    health.services.googlePlaces = {
      status: 'unhealthy',
      responseTime: Date.now() - googleStart,
      error: error.message
    };
    health.status = 'degraded';
  }

  // Test Companies House API (light test)
  try {
    const chStart = Date.now();
    const companiesHouse = new CompaniesHouseService();
    
    // Test with a known company number (Microsoft Limited)
    const profile = await companiesHouse.getCompanyProfile('01624297');
    
    const rateLimiterStats = companiesHouse.getRateLimiterStats();
    
    health.services.companiesHouse = {
      status: profile ? 'healthy' : 'degraded',
      responseTime: Date.now() - chStart,
      rateLimiter: rateLimiterStats
    };
  } catch (error) {
    health.services.companiesHouse = {
      status: 'unhealthy',
      responseTime: Date.now() - chStart,
      error: error.message
    };
    health.status = 'degraded';
  }

  // Overall execution time
  const totalTime = Date.now() - startTime;
  health.totalResponseTime = totalTime;

  // Determine overall status
  const serviceStatuses = Object.values(health.services).map(s => s.status);
  if (serviceStatuses.includes('unhealthy')) {
    health.status = 'unhealthy';
  } else if (serviceStatuses.includes('degraded')) {
    health.status = 'degraded';
  }

  // Set appropriate HTTP status code
  const statusCode = health.status === 'healthy' ? 200 : 
                    health.status === 'degraded' ? 200 : 503;

  console.log(`Health check completed in ${totalTime}ms with status: ${health.status}`);

  res.status(statusCode).json(health);
};