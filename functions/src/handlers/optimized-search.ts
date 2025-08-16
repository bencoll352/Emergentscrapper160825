import { Request, Response } from 'express';
import { BusinessSearchSchema, BusinessInfo, SearchResponse, TRADE_TYPE_MAPPING, ApiError, ValidationError } from '../types';
import { GooglePlacesService } from '../services/googlePlaces';
import { CompaniesHouseService } from '../services/companiesHouse';
import { OptimizedDatabaseService } from '../services/optimized-database';
import { IntelligentCacheService } from '../services/intelligent-cache';
import { asyncHandler } from '../middleware/errorHandler';
import pLimit from 'p-limit';

// Rate limiting for external APIs
const googlePlacesLimiter = pLimit(10);
const companiesHouseLimiter = pLimit(3);
const databaseLimiter = pLimit(20);

export const optimizedSearchHandler = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`🚀 [${requestId}] Optimized search request received:`, {
    body: req.body,
    userAgent: req.get('user-agent'),
    ip: req.ip
  });

  try {
    // Step 1: Validate input with detailed error messages
    const validationResult = BusinessSearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errorDetails = validationResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        received: err.received
      }));
      throw new ValidationError('Invalid request parameters', errorDetails);
    }

    const {
      location,
      radius,
      businessTypes,
      maxResults,
      enhanceWithCompaniesHouse,
      useCache
    } = validationResult.data;

    // Step 2: Initialize optimized services
    const cache = new IntelligentCacheService();
    const database = new OptimizedDatabaseService();

    // Step 3: Check intelligent cache with request deduplication
    if (useCache) {
      const cacheKey = `search_${location}_${radius}_${businessTypes.join(',')}_${enhanceWithCompaniesHouse}`;
      
      const cachedResults = await cache.deduplicateRequest(
        cacheKey,
        async () => {
          const cached = await cache.getSearchResults({
            location,
            radius,
            businessTypes,
            enhanceWithCompaniesHouse
          });
          return cached;
        },
        5000 // 5 second deduplication window
      );

      if (cachedResults) {
        const executionTime = Date.now() - startTime;
        console.log(`⚡ [${requestId}] Returning cached results in ${executionTime}ms`);
        
        res.set({
          'X-Cache': 'HIT',
          'X-Execution-Time': `${executionTime}ms`,
          'X-Request-Id': requestId as string
        });
        
        return res.json({
          ...cachedResults,
          executionTime,
          fromCache: true,
          requestId
        });
      }
    }

    // Step 4: Optimized coordinate conversion with caching
    const coordinateStartTime = Date.now();
    let coordinates: { lat: number; lng: number };
    
    try {
      const postcodeRegex = /^[A-Z]{1,2}[0-9R][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
      const isPostcode = postcodeRegex.test(location.trim());
      
      if (isPostcode) {
        // Check cache first
        coordinates = await cache.getPostcodeCoordinates(location) || 
          await googlePlacesLimiter(async () => {
            const googlePlaces = new GooglePlacesService();
            const coords = await googlePlaces.convertPostcodeToCoordinates(location);
            await cache.setPostcodeCoordinates(location, coords);
            return coords;
          });
      } else {
        coordinates = await googlePlacesLimiter(async () => {
          const googlePlaces = new GooglePlacesService();
          return googlePlaces.geocodeLocation(location);
        });
      }
    } catch (error) {
      throw new ApiError(400, `Unable to find location: ${location}. Please check the spelling and try again.`);
    }

    const coordinateTime = Date.now() - coordinateStartTime;
    console.log(`📍 [${requestId}] Coordinates resolved in ${coordinateTime}ms:`, coordinates);

    // Step 5: Check database cache for nearby businesses first
    const dbCacheStartTime = Date.now();
    let cachedBusinesses: BusinessInfo[] = [];
    
    try {
      cachedBusinesses = await database.findBusinessesNearOptimized(
        {
          type: 'Point',
          coordinates: [coordinates.lng, coordinates.lat]
        },
        radius,
        {
          businessType: businessTypes.length === 1 ? 
            TRADE_TYPE_MAPPING[businessTypes[0]]?.industry : undefined,
          limit: maxResults,
          minRating: 3.0 // Only return well-rated businesses from cache
        }
      );
    } catch (dbError) {
      console.warn(`⚠️ [${requestId}] Database cache failed:`, dbError);
    }

    const dbCacheTime = Date.now() - dbCacheStartTime;
    console.log(`💾 [${requestId}] Database cache checked in ${dbCacheTime}ms: ${cachedBusinesses.length} found`);

    // Step 6: Parallel API calls for fresh data
    const apiStartTime = Date.now();
    let freshBusinesses: BusinessInfo[] = [];

    if (cachedBusinesses.length < maxResults * 0.8) { // If we don't have enough cached results
      console.log(`🔍 [${requestId}] Fetching fresh data from APIs...`);
      
      const googlePlaces = new GooglePlacesService();
      
      // Parallel search across business types
      const searchPromises = businessTypes.map(businessType =>
        googlePlacesLimiter(async () => {
          try {
            return await googlePlaces.searchBusinessesNearby(
              coordinates,
              radius,
              businessType,
              Math.ceil(maxResults / businessTypes.length)
            );
          } catch (error) {
            console.error(`Google Places search failed for ${businessType}:`, error);
            return [];
          }
        })
      );

      const searchResultsArrays = await Promise.all(searchPromises);
      
      // Flatten and deduplicate
      const allPlaces = new Map();
      const businessTypeMap = new Map();
      
      searchResultsArrays.forEach((places, typeIndex) => {
        const businessType = businessTypes[typeIndex];
        places.forEach(place => {
          if (!allPlaces.has(place.place_id)) {
            allPlaces.set(place.place_id, place);
            businessTypeMap.set(place.place_id, businessType);
          }
        });
      });

      // Get detailed place information in parallel batches
      const placeIds = Array.from(allPlaces.keys()).slice(0, maxResults);
      const placeDetails = await googlePlaces.batchGetPlaceDetails(placeIds);

      // Step 7: Process fresh data
      const processPromises = Array.from(allPlaces.values()).slice(0, maxResults).map(async (place) => {
        const details = placeDetails[place.place_id];
        if (!details) return null;

        const businessType = businessTypeMap.get(place.place_id);
        const tradeMapping = TRADE_TYPE_MAPPING[businessType?.toLowerCase()];
        const address = details.formatted_address || '';
        const postcode = googlePlaces.extractPostcodeFromAddress(address);

        return {
          placeId: place.place_id,
          companyName: details.name || 'Unknown',
          tradespersonName: undefined,
          primaryIndustry: tradeMapping?.industry || businessType,
          fullAddress: address,
          postcode,
          websiteUrl: details.website,
          phoneNumber: details.formatted_phone_number,
          emailAddress: undefined,
          sourceUrl: enhanceWithCompaniesHouse ? 'Google Places API + Companies House API' : 'Google Places API',
          dateOfScraping: new Date().toISOString().split('T')[0],
          rating: details.rating,
          totalRatings: details.user_ratings_total,
          location: {
            type: 'Point' as const,
            coordinates: [place.geometry.location.lng, place.geometry.location.lat]
          },
          verificationStatus: 'unverified' as const,
          lastUpdated: new Date().toISOString(),
          cacheExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
      });

      const processedResults = await Promise.all(processPromises);
      freshBusinesses = processedResults.filter(Boolean) as BusinessInfo[];
    }

    const apiTime = Date.now() - apiStartTime;
    console.log(`🌐 [${requestId}] Fresh API data fetched in ${apiTime}ms: ${freshBusinesses.length} businesses`);

    // Step 8: Merge cached and fresh results intelligently
    const mergeStartTime = Date.now();
    const businessMap = new Map<string, BusinessInfo>();
    
    // Add cached businesses first (they're already optimized)
    cachedBusinesses.forEach(business => {
      businessMap.set(business.placeId, business);
    });
    
    // Add fresh businesses (prioritize newer data)
    freshBusinesses.forEach(business => {
      const existing = businessMap.get(business.placeId);
      if (!existing || new Date(business.lastUpdated) > new Date(existing.lastUpdated)) {
        businessMap.set(business.placeId, business);
      }
    });

    let allBusinesses = Array.from(businessMap.values()).slice(0, maxResults);
    const mergeTime = Date.now() - mergeStartTime;

    // Step 9: Companies House enhancement (optional, parallel)
    const enhanceStartTime = Date.now();
    if (enhanceWithCompaniesHouse && allBusinesses.length > 0) {
      console.log(`🏢 [${requestId}] Enhancing ${allBusinesses.length} businesses with Companies House data...`);
      
      const companiesHouse = new CompaniesHouseService();
      const enhancementPromises = allBusinesses.map(async (business, index) => {
        if (!business.companyName) return;
        
        return companiesHouseLimiter(async () => {
          try {
            const chData = await companiesHouse.enhanceBusinessData(
              business.companyName,
              business.postcode,
              business.fullAddress
            );
            
            if (chData) {
              allBusinesses[index].companiesHouseData = chData;
              allBusinesses[index].verificationStatus = 
                chData.companyStatus === 'active' ? 'verified' : 'inactive';
            }
          } catch (error) {
            console.warn(`CH enhancement failed for ${business.companyName}:`, error);
          }
        });
      });

      await Promise.allSettled(enhancementPromises);
      
      const enhancedCount = allBusinesses.filter(b => b.companiesHouseData).length;
      console.log(`🏢 [${requestId}] Enhanced ${enhancedCount}/${allBusinesses.length} businesses`);
    }

    const enhanceTime = Date.now() - enhanceStartTime;

    // Step 10: Intelligent sorting with multiple criteria
    const sortStartTime = Date.now();
    allBusinesses.sort((a, b) => {
      // Multi-criteria sorting
      const aScore = (
        (a.verificationStatus === 'verified' ? 1000 : 0) +
        ((a.rating || 0) * 100) +
        Math.min((a.totalRatings || 0), 500) // Cap influence of review count
      );
      
      const bScore = (
        (b.verificationStatus === 'verified' ? 1000 : 0) +
        ((b.rating || 0) * 100) +
        Math.min((b.totalRatings || 0), 500)
      );
      
      return bScore - aScore;
    });
    
    const sortTime = Date.now() - sortStartTime;

    // Step 11: Async database caching (don't wait for this)
    if (freshBusinesses.length > 0) {
      databaseLimiter(async () => {
        try {
          await database.bulkUpsertBusinesses(freshBusinesses);
          console.log(`💾 [${requestId}] Cached ${freshBusinesses.length} fresh businesses to database`);
        } catch (error) {
          console.error(`Database caching failed:`, error);
        }
      });
    }

    // Step 12: Prepare optimized response
    const executionTime = Date.now() - startTime;
    const response: SearchResponse = {
      success: true,
      totalFound: allBusinesses.length,
      businesses: allBusinesses,
      searchLocation: coordinates,
      searchParams: {
        location,
        radius,
        businessTypes,
        maxResults
      },
      fromCache: false,
      executionTime
    };

    // Step 13: Async intelligent caching
    if (useCache && allBusinesses.length > 0) {
      cache.setSearchResults(
        { location, radius, businessTypes, enhanceWithCompaniesHouse },
        response,
        24 * 60 * 60 * 1000
      );
    }

    // Step 14: Response with performance headers
    res.set({
      'X-Cache': 'MISS',
      'X-Execution-Time': `${executionTime}ms`,
      'X-Request-Id': requestId as string,
      'X-Performance-Breakdown': JSON.stringify({
        coordinate: coordinateTime,
        dbCache: dbCacheTime,
        apiCalls: apiTime,
        merge: mergeTime,
        enhancement: enhanceTime,
        sorting: sortTime
      })
    });

    console.log(`✅ [${requestId}] Search completed in ${executionTime}ms:`, {
      total: allBusinesses.length,
      verified: allBusinesses.filter(b => b.verificationStatus === 'verified').length,
      cached: cachedBusinesses.length,
      fresh: freshBusinesses.length
    });

    res.json({ ...response, requestId });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error(`❌ [${requestId}] Search failed in ${executionTime}ms:`, error);
    
    res.set({
      'X-Cache': 'ERROR',
      'X-Execution-Time': `${executionTime}ms`,
      'X-Request-Id': requestId as string
    });

    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }

    throw new ApiError(500, `Search failed: ${error.message}`, 'SEARCH_ERROR');
  }
});