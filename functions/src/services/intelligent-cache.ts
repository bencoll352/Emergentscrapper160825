import NodeCache from 'node-cache';
import { BusinessInfo, SearchResponse, CACHE_CONFIG } from '../types';

// Multi-tier caching system
export class IntelligentCacheService {
  private memoryCache: NodeCache;
  private requestMap: Map<string, Promise<any>> = new Map(); // Request deduplication
  private hitRates: Map<string, { hits: number; misses: number }> = new Map();
  private static instance: IntelligentCacheService;

  constructor() {
    if (IntelligentCacheService.instance) {
      return IntelligentCacheService.instance;
    }

    this.memoryCache = new NodeCache({
      stdTTL: CACHE_CONFIG.BUSINESS_SEARCH_TTL / 1000,
      maxKeys: CACHE_CONFIG.MAX_CACHE_SIZE,
      useClones: false, // Better performance
      deleteOnExpire: true,
      checkperiod: 300, // Check every 5 minutes
    });

    // Advanced cache monitoring
    this.memoryCache.on('set', this.onCacheSet.bind(this));
    this.memoryCache.on('expired', this.onCacheExpired.bind(this));
    this.memoryCache.on('flush', this.onCacheFlush.bind(this));

    // Periodic optimization
    setInterval(this.optimizeCache.bind(this), 10 * 60 * 1000); // Every 10 minutes

    IntelligentCacheService.instance = this;
  }

  private onCacheSet(key: string, value: any): void {
    const size = JSON.stringify(value).length;
    console.log(`🔧 Cache SET: ${key} (${this.formatBytes(size)})`);
  }

  private onCacheExpired(key: string, value: any): void {
    console.log(`⏰ Cache EXPIRED: ${key}`);
    this.updateHitRate(key, false);
  }

  private onCacheFlush(): void {
    console.log('🧹 Cache FLUSHED');
    this.hitRates.clear();
  }

  private optimizeCache(): void {
    const stats = this.memoryCache.getStats();
    const memoryUsage = process.memoryUsage();
    
    console.log('🔍 Cache optimization check:', {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%',
      memoryUsed: this.formatBytes(memoryUsage.heapUsed)
    });

    // Auto-cleanup if memory usage is high
    if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
      this.intelligentCleanup();
    }
  }

  // Request deduplication - CRITICAL for performance
  async deduplicateRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Check if request is already in progress
    if (this.requestMap.has(key)) {
      console.log(`🔄 Request DEDUPLICATED: ${key}`);
      return this.requestMap.get(key)!;
    }

    // Execute request and cache promise
    const promise = requestFn().finally(() => {
      // Cleanup after request completes
      this.requestMap.delete(key);
    });

    this.requestMap.set(key, promise);
    
    const result = await promise;
    
    // Cache the result if TTL is specified
    if (ttl) {
      this.memoryCache.set(key, result, ttl);
    }
    
    return result;
  }

  // Intelligent cache key generation with compression
  private generateIntelligentKey(prefix: string, params: any): string {
    const normalized = this.normalizeParams(params);
    const hash = this.quickHash(JSON.stringify(normalized));
    return `${prefix}:${hash}`;
  }

  private normalizeParams(params: any): any {
    if (typeof params === 'string') {
      return params.toLowerCase().replace(/\s+/g, '_');
    }
    
    if (Array.isArray(params)) {
      return params.sort().map(this.normalizeParams);
    }
    
    if (typeof params === 'object' && params !== null) {
      const normalized: any = {};
      for (const [key, value] of Object.entries(params)) {
        normalized[key] = this.normalizeParams(value);
      }
      return normalized;
    }
    
    return params;
  }

  private quickHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Hierarchical caching with priorities
  async getWithPriority<T>(
    key: string,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<T | null> {
    const cached = this.memoryCache.get<T>(key);
    
    if (cached) {
      console.log(`🎯 Cache HIT (${priority}): ${key}`);
      this.updateHitRate(key, true);
      
      // Extend TTL for high-priority items
      if (priority === 'high') {
        this.memoryCache.ttl(key, CACHE_CONFIG.BUSINESS_SEARCH_TTL * 2);
      }
      
      return cached;
    }
    
    console.log(`❌ Cache MISS (${priority}): ${key}`);
    this.updateHitRate(key, false);
    return null;
  }

  async setWithPriority<T>(
    key: string,
    value: T,
    priority: 'high' | 'medium' | 'low' = 'medium',
    customTTL?: number
  ): Promise<void> {
    let ttl = customTTL || CACHE_CONFIG.BUSINESS_SEARCH_TTL;
    
    // Adjust TTL based on priority
    switch (priority) {
      case 'high':
        ttl *= 2;
        break;
      case 'low':
        ttl *= 0.5;
        break;
    }
    
    this.memoryCache.set(key, value, Math.floor(ttl / 1000));
    console.log(`💾 Cache SET (${priority}): ${key} (TTL: ${this.formatDuration(ttl)})`);
  }

  // Batch operations with compression
  async setBatch(items: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    const operations = items.map(({ key, value, ttl }) => {
      return new Promise<void>((resolve) => {
        this.memoryCache.set(key, value, ttl ? Math.floor(ttl / 1000) : undefined);
        resolve();
      });
    });

    await Promise.all(operations);
    console.log(`📦 Batch SET: ${items.length} items`);
  }

  async getBatch<T>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    let hits = 0;

    for (const key of keys) {
      const cached = this.memoryCache.get<T>(key);
      if (cached) {
        results.set(key, cached);
        hits++;
      }
    }

    console.log(`📦 Batch GET: ${hits}/${keys.length} hits (${((hits/keys.length)*100).toFixed(1)}%)`);
    return results;
  }

  // Search-specific optimized methods
  async getSearchResults(searchParams: {
    location: string;
    radius: number;
    businessTypes: string[];
    enhanceWithCompaniesHouse: boolean;
  }): Promise<SearchResponse | null> {
    const key = this.generateIntelligentKey('search', searchParams);
    return this.getWithPriority(key, 'high');
  }

  async setSearchResults(
    searchParams: {
      location: string;
      radius: number;
      businessTypes: string[];
      enhanceWithCompaniesHouse: boolean;
    },
    results: SearchResponse,
    ttl?: number
  ): Promise<void> {
    const key = this.generateIntelligentKey('search', searchParams);
    await this.setWithPriority(key, results, 'high', ttl);
  }

  // Postcode caching with geographic clustering
  async getPostcodeCoordinates(postcode: string): Promise<{ lat: number; lng: number } | null> {
    const key = `postcode:${postcode.replace(/\s+/g, '').toUpperCase()}`;
    return this.getWithPriority(key, 'high');
  }

  async setPostcodeCoordinates(
    postcode: string,
    coordinates: { lat: number; lng: number }
  ): Promise<void> {
    const key = `postcode:${postcode.replace(/\s+/g, '').toUpperCase()}`;
    await this.setWithPriority(key, coordinates, 'high', CACHE_CONFIG.POSTCODE_LOOKUP_TTL);
  }

  // Companies House caching with smart invalidation
  async getCompanyData(companyNumber: string): Promise<any | null> {
    const key = `company:${companyNumber.toUpperCase()}`;
    return this.getWithPriority(key, 'medium');
  }

  async setCompanyData(companyNumber: string, data: any): Promise<void> {
    const key = `company:${companyNumber.toUpperCase()}`;
    await this.setWithPriority(key, data, 'medium', CACHE_CONFIG.COMPANIES_HOUSE_TTL);
  }

  // Predictive cache warming
  async warmupPredictiveCache(patterns: Array<{
    location: string;
    businessTypes: string[];
    priority?: 'high' | 'medium' | 'low';
  }>): Promise<void> {
    console.log(`🔥 Starting predictive cache warmup for ${patterns.length} patterns...`);

    const warmupPromises = patterns.map(async (pattern, index) => {
      try {
        // Generate cache keys for popular search combinations
        const baseParams = {
          location: pattern.location,
          radius: 20000,
          businessTypes: pattern.businessTypes,
          enhanceWithCompaniesHouse: true
        };

        const key = this.generateIntelligentKey('search', baseParams);
        
        // Pre-warm postcode cache
        if (/^[A-Z]{1,2}[0-9]/.test(pattern.location)) {
          // This looks like a postcode
          const postcodeKey = `postcode:${pattern.location.replace(/\s+/g, '').toUpperCase()}`;
          console.log(`🔥 Warmup postcode: ${postcodeKey}`);
        }
        
        // Add small delay between warmups
        await new Promise(resolve => setTimeout(resolve, index * 100));
        
      } catch (error) {
        console.error(`Warmup failed for pattern ${index}:`, error);
      }
    });

    await Promise.allSettled(warmupPromises);
    console.log('🔥 Predictive cache warmup completed');
  }

  // Intelligent cleanup based on usage patterns
  private intelligentCleanup(): void {
    const keys = this.memoryCache.keys();
    const toDelete: string[] = [];
    
    for (const key of keys) {
      const hitRate = this.hitRates.get(key);
      if (hitRate && (hitRate.hits / (hitRate.hits + hitRate.misses)) < 0.1) {
        // Delete items with less than 10% hit rate
        toDelete.push(key);
      }
    }
    
    for (const key of toDelete) {
      this.memoryCache.del(key);
      this.hitRates.delete(key);
    }
    
    console.log(`🧹 Intelligent cleanup: removed ${toDelete.length} low-usage items`);
  }

  private updateHitRate(key: string, hit: boolean): void {
    const current = this.hitRates.get(key) || { hits: 0, misses: 0 };
    if (hit) {
      current.hits++;
    } else {
      current.misses++;
    }
    this.hitRates.set(key, current);
  }

  // Performance monitoring
  getAdvancedStats(): {
    memory: any;
    hitRates: any;
    performance: any;
  } {
    const stats = this.memoryCache.getStats();
    const memoryUsage = process.memoryUsage();
    
    return {
      memory: {
        heapUsed: this.formatBytes(memoryUsage.heapUsed),
        heapTotal: this.formatBytes(memoryUsage.heapTotal),
        external: this.formatBytes(memoryUsage.external)
      },
      hitRates: {
        overall: ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%',
        keys: stats.keys,
        hits: stats.hits,
        misses: stats.misses
      },
      performance: {
        activeRequests: this.requestMap.size,
        trackedKeys: this.hitRates.size
      }
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  async close(): Promise<void> {
    this.memoryCache.close();
    this.requestMap.clear();
    this.hitRates.clear();
  }
}