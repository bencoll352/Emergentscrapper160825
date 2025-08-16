import { Request, Response } from 'express';
import { CachedBusinessesSchema, ApiError, ValidationError } from '../types';
import { DatabaseService } from '../services/database';
import { asyncHandler } from '../middleware/errorHandler';

export const cachedBusinessesHandler = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log('Cached businesses request received:', req.query);

  try {
    // Validate query parameters
    const validationResult = CachedBusinessesSchema.safeParse({
      lat: parseFloat(req.query.lat as string),
      lng: parseFloat(req.query.lng as string),
      radius: req.query.radius ? parseInt(req.query.radius as string) : undefined,
      businessType: req.query.businessType as string,
      verifiedOnly: req.query.verifiedOnly === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
    });

    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', validationResult.error.errors);
    }

    const {
      lat,
      lng,
      radius,
      businessType,
      verifiedOnly,
      limit,
      offset
    } = validationResult.data;

    // Initialize database service
    const database = new DatabaseService();
    await database.connect();

    // Create location object for geospatial query
    const location = {
      type: 'Point' as const,
      coordinates: [lng, lat]
    };

    console.log(`Searching cached businesses near ${lat}, ${lng} within ${radius}m`);

    // Query cached businesses
    const businesses = await database.findBusinessesNear(location, radius, {
      businessType,
      verifiedOnly,
      limit,
      offset
    });

    // Get statistics if it's the first page
    let stats = undefined;
    if (offset === 0) {
      try {
        stats = await database.getBusinessStats(location, radius);
        console.log('Business stats:', stats);
      } catch (error) {
        console.error('Failed to get business stats:', error);
      }
    }

    const executionTime = Date.now() - startTime;

    console.log(`Found ${businesses.length} cached businesses in ${executionTime}ms`);

    res.json({
      success: true,
      totalFound: businesses.length,
      businesses,
      searchLocation: { lat, lng },
      radius,
      filters: {
        businessType,
        verifiedOnly,
        limit,
        offset
      },
      stats,
      fromCache: true,
      executionTime
    });

  } catch (error) {
    console.error('Cached businesses error:', error);
    
    const executionTime = Date.now() - startTime;
    
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }

    throw new ApiError(500, `Failed to retrieve cached businesses: ${error.message}`);
  }
});