import { Request, Response } from 'express';
import { BusinessSearchSchema, BusinessInfo, SearchResponse, TRADE_TYPE_MAPPING, ApiError, ValidationError } from '../types';
import { GooglePlacesService } from '../services/googlePlaces';
import { CompaniesHouseService } from '../services/companiesHouse';
import { DatabaseService } from '../services/database';
import { CacheService } from '../services/cache';
import { asyncHandler } from '../middleware/errorHandler';

export const searchBusinessesHandler = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log('Search businesses request received:', req.body);

  try {
    // Validate request body
    const validationResult = BusinessSearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError('Invalid request parameters', validationResult.error.errors);
    }

    const {
      location,
      radius,
      businessTypes,
      maxResults,
      enhanceWithCompaniesHouse,
      useCache
    } = validationResult.data;

    // Initialize services
    const googlePlaces = new GooglePlacesService();
    const companiesHouse = new CompaniesHouseService();
    const database = new DatabaseService();
    const cache = new CacheService();

    // Check cache first if enabled
    if (useCache) {
      const cachedResults = await cache.getSearchResults(
        location,
        radius,
        businessTypes,
        enhanceWithCompaniesHouse
      );

      if (cachedResults) {
        console.log(`Returning cached results for location: ${location}`);
        const executionTime = Date.now() - startTime;
        
        res.json({
          ...cachedResults,
          executionTime,
          fromCache: true
        });
        return;
      }
    }

    // Convert location to coordinates
    let coordinates: { lat: number; lng: number };
    
    try {
      // Check if it's a UK postcode format
      const postcodeRegex = /^[A-Z]{1,2}[0-9R][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
      if (postcodeRegex.test(location.trim())) {
        coordinates = await googlePlaces.convertPostcodeToCoordinates(location);
      } else {
        coordinates = await googlePlaces.geocodeLocation(location);
      }
    } catch (error) {
      throw new ApiError(400, `Unable to find location: ${location}`);
    }

    console.log(`Coordinates for ${location}:`, coordinates);

    // Search for businesses by types in parallel
    const searchResults = await googlePlaces.searchBusinessesByTypes(
      coordinates,
      radius,
      businessTypes,
      Math.ceil(maxResults / businessTypes.length)
    );

    // Flatten and deduplicate results
    const allPlaces = new Map<string, any>();
    const businessTypeMap = new Map<string, string>();

    for (const [businessType, places] of Object.entries(searchResults)) {
      for (const place of places) {
        if (!allPlaces.has(place.place_id)) {
          allPlaces.set(place.place_id, place);
          businessTypeMap.set(place.place_id, businessType);
        }
      }
    }

    console.log(`Found ${allPlaces.size} unique businesses across ${businessTypes.length} trade types`);

    // Limit results
    const limitedPlaces = Array.from(allPlaces.values()).slice(0, maxResults);
    const placeIds = limitedPlaces.map(place => place.place_id);

    // Get detailed place information in batches
    const placeDetails = await googlePlaces.batchGetPlaceDetails(placeIds);

    // Process businesses and enhance with Companies House data
    const businesses: BusinessInfo[] = [];
    const businessesForEnhancement: Array<{ name: string; postcode?: string; address?: string }> = [];

    // Process Google Places data first
    for (const place of limitedPlaces) {
      const details = placeDetails[place.place_id];
      if (!details || details === null) continue;

      const businessType = businessTypeMap.get(place.place_id) || 'general';
      const tradeMapping = TRADE_TYPE_MAPPING[businessType.toLowerCase()];
      const address = details.formatted_address || '';
      const postcode = googlePlaces.extractPostcodeFromAddress(address);

      const business: BusinessInfo = {
        placeId: place.place_id,
        companyName: details.name || 'Unknown',
        tradespersonName: undefined,
        primaryIndustry: tradeMapping?.industry || businessType,
        fullAddress: address,
        postcode,
        websiteUrl: details.website,
        phoneNumber: details.formatted_phone_number,
        emailAddress: undefined, // Not available from Google Places
        sourceUrl: 'Google Places API + Companies House API',
        dateOfScraping: new Date().toISOString().split('T')[0],
        rating: details.rating,
        totalRatings: details.user_ratings_total,
        location: {
          type: 'Point',
          coordinates: [place.geometry.location.lng, place.geometry.location.lat]
        },
        verificationStatus: 'unverified',
        lastUpdated: new Date(),
        cacheExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };

      businesses.push(business);

      // Prepare for Companies House enhancement
      if (enhanceWithCompaniesHouse && details.name) {
        businessesForEnhancement.push({
          name: details.name,
          postcode,
          address
        });
      }
    }

    // Enhance with Companies House data in parallel if requested
    if (enhanceWithCompaniesHouse && businessesForEnhancement.length > 0) {
      console.log(`Enhancing ${businessesForEnhancement.length} businesses with Companies House data`);
      
      try {
        const companiesHouseData = await companiesHouse.batchEnhanceBusinesses(businessesForEnhancement);
        
        // Merge Companies House data with businesses
        for (let i = 0; i < businesses.length && i < companiesHouseData.length; i++) {
          const chData = companiesHouseData[i];
          if (chData) {
            businesses[i].companiesHouseData = chData;
            businesses[i].verificationStatus = chData.companyStatus === 'active' ? 'verified' : 'inactive';
            businesses[i].sourceUrl = 'Google Places API + Companies House API';
          }
        }

        const enhancedCount = companiesHouseData.filter(d => d !== null).length;
        console.log(`Enhanced ${enhancedCount}/${businesses.length} businesses with Companies House data`);
      } catch (error) {
        console.error('Companies House enhancement failed:', error);
        // Continue without enhancement rather than failing the entire request
      }
    }

    // Sort businesses: verified first, then by rating, then by review count
    businesses.sort((a, b) => {
      // Verification status priority
      const statusPriority = { verified: 3, inactive: 2, unverified: 1 };
      const statusDiff = statusPriority[b.verificationStatus] - statusPriority[a.verificationStatus];
      if (statusDiff !== 0) return statusDiff;

      // Rating priority
      const ratingDiff = (b.rating || 0) - (a.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;

      // Review count priority
      return (b.totalRatings || 0) - (a.totalRatings || 0);
    });

    // Cache businesses in database
    try {
      await database.connect();
      const cachePromises = businesses.map(business => database.upsertBusiness(business));
      await Promise.allSettled(cachePromises);
      console.log(`Cached ${businesses.length} businesses in database`);
    } catch (error) {
      console.error('Database caching failed:', error);
      // Continue without database caching
    }

    // Prepare response
    const executionTime = Date.now() - startTime;
    const response: SearchResponse = {
      success: true,
      totalFound: businesses.length,
      businesses,
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

    // Cache the response for future requests
    if (useCache && businesses.length > 0) {
      try {
        await cache.setSearchResults(
          location,
          radius,
          businessTypes,
          enhanceWithCompaniesHouse,
          response,
          24 * 60 * 60 * 1000 // 24 hours
        );
      } catch (error) {
        console.error('Response caching failed:', error);
      }
    }

    console.log(`Search completed in ${executionTime}ms: ${businesses.length} businesses found`);
    
    res.json(response);

  } catch (error) {
    console.error('Search businesses error:', error);
    
    const executionTime = Date.now() - startTime;
    
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error; // Will be handled by error middleware
    }

    throw new ApiError(500, `Search failed: ${error.message}`);
  }
});