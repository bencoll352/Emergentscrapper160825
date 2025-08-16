import NodeCache from 'node-cache';
import { BusinessInfo, SearchResponse, CACHE_CONFIG } from '../types';

export class CacheService {
  private cache: NodeCache;
  private static instance: CacheService;

  constructor() {
    if (CacheService.instance) {
      return CacheService.instance;
    }

    this.cache = new NodeCache({
      stdTTL: CACHE_CONFIG.BUSINESS_SEARCH_TTL / 1000, // Convert to seconds
      maxKeys: CACHE_CONFIG.MAX_CACHE_SIZE,
      useClones: false,
      deleteOnExpire: true,
      checkperiod: 600 // Check for expired keys every 10 minutes
    });

    // Set up cache event listeners for monitoring
    this.cache.on('set', (key, value) => {
      console.log(`Cache SET: ${key}`);
    });

    this.cache.on('expired', (key, value) => {
      console.log(`Cache EXPIRED: ${key}`);
    });

    CacheService.instance = this;
  }

  // Generate cache keys
  private generateSearchKey(
    location: string,
    radius: number,
    businessTypes: string[],
    enhanceWithCompaniesHouse: boolean
  ): string {
    const normalized = {
      location: location.toLowerCase().replace(/\s+/g, '_'),
      radius,
      types: businessTypes.sort().join(','),
      enhanced: enhanceWithCompaniesHouse
    };
    return `search:${normalized.location}:${normalized.radius}:${normalized.types}:${normalized.enhanced}`;
  }

  private generatePostcodeKey(postcode: string): string {
    return `postcode:${postcode.replace(/\s+/g, '').toUpperCase()}`;
  }

  private generateCompanyKey(companyNumber: string): string {
    return `company:${companyNumber.toUpperCase()}`;
  }

  private generatePlaceKey(placeId: string): string {
    return `place:${placeId}`;
  }

  // Search results caching
  async getSearchResults(
    location: string,
    radius: number,
    businessTypes: string[],
    enhanceWithCompaniesHouse: boolean
  ): Promise<SearchResponse | null> {
    const key = this.generateSearchKey(location, radius, businessTypes, enhanceWithCompaniesHouse);
    
    try {
      const cached = this.cache.get<SearchResponse>(key);
      if (cached) {
        console.log(`Cache HIT: ${key}`);
        return {
          ...cached,
          fromCache: true
        };
      }
      console.log(`Cache MISS: ${key}`);
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async setSearchResults(
    location: string,
    radius: number,
    businessTypes: string[],
    enhanceWithCompaniesHouse: boolean,
    results: SearchResponse,
    ttl?: number
  ): Promise<void> {
    const key = this.generateSearchKey(location, radius, businessTypes, enhanceWithCompaniesHouse);
    
    try {
      const cacheValue = {
        ...results,
        fromCache: false,
        cachedAt: new Date().toISOString()
      };

      if (ttl) {
        this.cache.set(key, cacheValue, ttl / 1000);
      } else {
        this.cache.set(key, cacheValue);
      }
      
      console.log(`Cache SET: ${key} with TTL ${ttl || 'default'}`);
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  // Postcode coordinates caching
  async getPostcodeCoordinates(postcode: string): Promise<{ lat: number; lng: number } | null> {
    const key = this.generatePostcodeKey(postcode);
    
    try {
      const cached = this.cache.get<{ lat: number; lng: number }>(key);
      if (cached) {
        console.log(`Postcode cache HIT: ${key}`);
        return cached;
      }
      return null;
    } catch (error) {
      console.error('Postcode cache get error:', error);
      return null;
    }
  }

  async setPostcodeCoordinates(
    postcode: string,
    coordinates: { lat: number; lng: number }
  ): Promise<void> {
    const key = this.generatePostcodeKey(postcode);
    
    try {
      this.cache.set(key, coordinates, CACHE_CONFIG.POSTCODE_LOOKUP_TTL / 1000);
      console.log(`Postcode cache SET: ${key}`);
    } catch (error) {
      console.error('Postcode cache set error:', error);
    }
  }

  // Companies House data caching
  async getCompanyData(companyNumber: string): Promise<any | null> {
    const key = this.generateCompanyKey(companyNumber);
    
    try {
      const cached = this.cache.get(key);
      if (cached) {
        console.log(`Company cache HIT: ${key}`);
        return cached;
      }
      return null;
    } catch (error) {
      console.error('Company cache get error:', error);
      return null;
    }
  }

  async setCompanyData(companyNumber: string, data: any): Promise<void> {
    const key = this.generateCompanyKey(companyNumber);
    
    try {
      this.cache.set(key, data, CACHE_CONFIG.COMPANIES_HOUSE_TTL / 1000);
      console.log(`Company cache SET: ${key}`);
    } catch (error) {
      console.error('Company cache set error:', error);
    }
  }

  // Google Places data caching
  async getPlaceDetails(placeId: string): Promise<any | null> {
    const key = this.generatePlaceKey(placeId);
    
    try {
      const cached = this.cache.get(key);
      if (cached) {
        console.log(`Place cache HIT: ${key}`);
        return cached;
      }
      return null;
    } catch (error) {
      console.error('Place cache get error:', error);
      return null;
    }
  }

  async setPlaceDetails(placeId: string, data: any): Promise<void> {
    const key = this.generatePlaceKey(placeId);
    
    try {
      this.cache.set(key, data, CACHE_CONFIG.BUSINESS_SEARCH_TTL / 1000);
      console.log(`Place cache SET: ${key}`);
    } catch (error) {
      console.error('Place cache set error:', error);
    }
  }

  // Batch operations for efficiency
  async setMultipleBusinesses(businesses: BusinessInfo[]): Promise<void> {
    try {
      for (const business of businesses) {
        const key = this.generatePlaceKey(business.placeId);
        this.cache.set(key, business, CACHE_CONFIG.BUSINESS_SEARCH_TTL / 1000);
      }
      console.log(`Batch cache SET: ${businesses.length} businesses`);
    } catch (error) {
      console.error('Batch cache set error:', error);
    }
  }

  async getMultipleBusinesses(placeIds: string[]): Promise<BusinessInfo[]> {
    const businesses: BusinessInfo[] = [];
    
    try {
      for (const placeId of placeIds) {
        const key = this.generatePlaceKey(placeId);
        const cached = this.cache.get<BusinessInfo>(key);
        if (cached) {
          businesses.push(cached);
        }
      }
      console.log(`Batch cache GET: ${businesses.length}/${placeIds.length} found`);
      return businesses;
    } catch (error) {
      console.error('Batch cache get error:', error);
      return [];
    }
  }

  // Cache management
  async invalidateSearchPattern(pattern: string): Promise<void> {
    try {
      const keys = this.cache.keys();
      const matchingKeys = keys.filter(key => key.includes(pattern));
      
      for (const key of matchingKeys) {
        this.cache.del(key);
      }
      
      console.log(`Invalidated ${matchingKeys.length} cache entries matching pattern: ${pattern}`);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  async warmupPopularSearches(): Promise<void> {
    // Popular UK locations for warming up cache
    const popularLocations = [
      { name: 'London', coords: { lat: 51.5074, lng: -0.1278 } },
      { name: 'Manchester', coords: { lat: 53.4808, lng: -2.2426 } },
      { name: 'Birmingham', coords: { lat: 52.4862, lng: -1.8904 } },
      { name: 'Leeds', coords: { lat: 53.8008, lng: -1.5491 } },
      { name: 'Glasgow', coords: { lat: 55.8642, lng: -4.2518 } }
    ];

    const popularTrades = [
      ['builder', 'electrician'],
      ['plumber', 'carpenter'],
      ['painter', 'decorator']
    ];

    console.log('Starting cache warmup...');

    try {
      for (const location of popularLocations) {
        for (const trades of popularTrades) {
          // Cache postcode coordinates
          const postcodeKey = this.generatePostcodeKey(location.name);
          this.cache.set(postcodeKey, location.coords, CACHE_CONFIG.POSTCODE_LOOKUP_TTL / 1000);

          // Pre-generate search cache keys (actual search would be done on demand)
          const searchKey = this.generateSearchKey(location.name, 20000, trades, true);
          console.log(`Warmup cache key prepared: ${searchKey}`);
        }
      }
      
      console.log('Cache warmup completed');
    } catch (error) {
      console.error('Cache warmup error:', error);
    }
  }

  // Cache statistics
  getStats(): {
    keys: number;
    hits: number;
    misses: number;
    ksize: number;
    vsize: number;
  } {
    return this.cache.getStats();
  }

  // Clear all cache
  async flushAll(): Promise<void> {
    this.cache.flushAll();
    console.log('Cache flushed completely');
  }

  // Close cache
  async close(): Promise<void> {
    this.cache.close();
  }
}