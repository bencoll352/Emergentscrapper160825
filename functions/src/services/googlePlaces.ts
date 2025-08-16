import axios, { AxiosInstance } from 'axios';
import pLimit from 'p-limit';
import { GooglePlaceResult, TRADE_TYPE_MAPPING, ExternalApiError, Location } from '../types';
import { CacheService } from './cache';

export class GooglePlacesService {
  private client: AxiosInstance;
  private cache: CacheService;
  private rateLimiter = pLimit(5); // Limit concurrent requests
  private static instance: GooglePlacesService;

  constructor() {
    if (GooglePlacesService.instance) {
      return GooglePlacesService.instance;
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY environment variable is required');
    }

    this.client = axios.create({
      baseURL: 'https://maps.googleapis.com/maps/api/place',
      timeout: 10000,
      params: {
        key: apiKey
      }
    });

    this.cache = new CacheService();
    GooglePlacesService.instance = this;
  }

  async convertPostcodeToCoordinates(postcode: string): Promise<{ lat: number; lng: number }> {
    // Check cache first
    const cached = await this.cache.getPostcodeCoordinates(postcode);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.rateLimiter(() =>
        this.client.get('/geocoding/json', {
          baseURL: 'https://maps.googleapis.com/maps/api/geocode',
          params: {
            address: `${postcode}, UK`,
            region: 'uk'
          }
        })
      );

      const results = response.data.results;
      if (!results || results.length === 0) {
        throw new ExternalApiError(`Invalid UK postcode: ${postcode}`, 'GoogleGeocoding');
      }

      const coordinates = {
        lat: results[0].geometry.location.lat,
        lng: results[0].geometry.location.lng
      };

      // Cache the result
      await this.cache.setPostcodeCoordinates(postcode, coordinates);

      return coordinates;
    } catch (error: any) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      throw new ExternalApiError(
        `Failed to convert postcode to coordinates: ${error.message}`,
        'GoogleGeocoding',
        error
      );
    }
  }

  async searchBusinessesNearby(
    coordinates: { lat: number; lng: number },
    radius: number,
    businessType: string,
    maxResults: number = 20
  ): Promise<GooglePlaceResult[]> {
    const tradeMapping = TRADE_TYPE_MAPPING[businessType.toLowerCase()];
    if (!tradeMapping) {
      throw new Error(`Unsupported business type: ${businessType}`);
    }

    const allResults: GooglePlaceResult[] = [];
    let nextPageToken: string | undefined;

    try {
      do {
        const params: any = {
          location: `${coordinates.lat},${coordinates.lng}`,
          radius,
          type: tradeMapping.googleType,
          keyword: tradeMapping.keyword
        };

        if (nextPageToken) {
          params.pagetoken = nextPageToken;
          // Wait for pagetoken to be ready (required by Google Places API)
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const response = await this.rateLimiter(() =>
          this.client.get('/nearbysearch/json', { params })
        );

        const data = response.data;
        
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          throw new ExternalApiError(
            `Google Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`,
            'GooglePlaces'
          );
        }

        if (data.results && data.results.length > 0) {
          allResults.push(...data.results);
        }

        nextPageToken = data.next_page_token;

        // Stop if we have enough results or no more pages
        if (allResults.length >= maxResults || !nextPageToken) {
          break;
        }

      } while (nextPageToken && allResults.length < maxResults);

      // Trim to requested max results
      return allResults.slice(0, maxResults);

    } catch (error: any) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      throw new ExternalApiError(
        `Failed to search businesses: ${error.message}`,
        'GooglePlaces',
        error
      );
    }
  }

  async getPlaceDetails(placeId: string): Promise<any> {
    // Check cache first
    const cached = await this.cache.getPlaceDetails(placeId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.rateLimiter(() =>
        this.client.get('/details/json', {
          params: {
            place_id: placeId,
            fields: [
              'name',
              'formatted_address',
              'formatted_phone_number',
              'website',
              'rating',
              'user_ratings_total',
              'opening_hours',
              'business_status',
              'price_level'
            ].join(',')
          }
        })
      );

      const data = response.data;
      
      if (data.status !== 'OK') {
        throw new ExternalApiError(
          `Google Places details API error: ${data.status}`,
          'GooglePlaces'
        );
      }

      const result = data.result;
      
      // Cache the result
      await this.cache.setPlaceDetails(placeId, result);

      return result;

    } catch (error: any) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      throw new ExternalApiError(
        `Failed to get place details: ${error.message}`,
        'GooglePlaces',
        error
      );
    }
  }

  async searchBusinessesByTypes(
    coordinates: { lat: number; lng: number },
    radius: number,
    businessTypes: string[],
    maxResultsPerType: number = 20
  ): Promise<{ [businessType: string]: GooglePlaceResult[] }> {
    const results: { [businessType: string]: GooglePlaceResult[] } = {};

    // Process business types in parallel with rate limiting
    const searchPromises = businessTypes.map(businessType =>
      this.rateLimiter(async () => {
        try {
          const businessResults = await this.searchBusinessesNearby(
            coordinates,
            radius,
            businessType,
            maxResultsPerType
          );
          results[businessType] = businessResults;
          return { businessType, count: businessResults.length };
        } catch (error) {
          console.error(`Failed to search for ${businessType}:`, error);
          results[businessType] = [];
          return { businessType, count: 0, error: error.message };
        }
      })
    );

    const searchResults = await Promise.all(searchPromises);
    
    // Log results summary
    const summary = searchResults.map(r => `${r.businessType}: ${r.count}`).join(', ');
    console.log(`Search results summary - ${summary}`);

    return results;
  }

  async batchGetPlaceDetails(placeIds: string[]): Promise<{ [placeId: string]: any }> {
    const results: { [placeId: string]: any } = {};

    // Check cache for all place IDs first
    const cachedBusinesses = await this.cache.getMultipleBusinesses(placeIds);
    const cachedPlaceIds = new Set(cachedBusinesses.map(b => b.placeId));

    // Get uncached place IDs
    const uncachedPlaceIds = placeIds.filter(id => !cachedPlaceIds.has(id));

    // Add cached results
    cachedBusinesses.forEach(business => {
      results[business.placeId] = business;
    });

    if (uncachedPlaceIds.length === 0) {
      return results;
    }

    // Fetch uncached place details in parallel
    const detailPromises = uncachedPlaceIds.map(placeId =>
      this.rateLimiter(async () => {
        try {
          const details = await this.getPlaceDetails(placeId);
          results[placeId] = details;
          return { placeId, success: true };
        } catch (error) {
          console.error(`Failed to get details for ${placeId}:`, error);
          results[placeId] = null;
          return { placeId, success: false, error: error.message };
        }
      })
    );

    const detailResults = await Promise.all(detailPromises);
    
    // Log batch results
    const successful = detailResults.filter(r => r.success).length;
    const failed = detailResults.length - successful;
    console.log(`Batch place details: ${successful} successful, ${failed} failed`);

    return results;
  }

  // Geocoding for addresses/locations
  async geocodeLocation(location: string): Promise<{ lat: number; lng: number }> {
    try {
      const response = await this.rateLimiter(() =>
        this.client.get('/geocoding/json', {
          baseURL: 'https://maps.googleapis.com/maps/api/geocode',
          params: {
            address: `${location}, UK`,
            region: 'uk'
          }
        })
      );

      const results = response.data.results;
      if (!results || results.length === 0) {
        throw new ExternalApiError(`Location not found: ${location}`, 'GoogleGeocoding');
      }

      return {
        lat: results[0].geometry.location.lat,
        lng: results[0].geometry.location.lng
      };
    } catch (error: any) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      throw new ExternalApiError(
        `Failed to geocode location: ${error.message}`,
        'GoogleGeocoding',
        error
      );
    }
  }

  // Extract postcode from address
  extractPostcodeFromAddress(address: string): string | null {
    const postcodeRegex = /([A-Z]{1,2}[0-9R][0-9A-Z]? ?[0-9][A-Z]{2})/gi;
    const match = address.match(postcodeRegex);
    return match ? match[0].toUpperCase() : null;
  }

  // Get rate limiter stats
  getRateLimiterStats(): { pending: number; active: number } {
    return {
      pending: this.rateLimiter.pendingCount,
      active: this.rateLimiter.activeCount
    };
  }
}