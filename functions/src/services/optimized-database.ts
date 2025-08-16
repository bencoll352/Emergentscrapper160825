import { MongoClient, Db, Collection, CreateIndexesOptions, WriteConcern } from 'mongodb';
import { BusinessInfo, Location } from '../types';

// Connection pool with optimizations
class MongoConnectionPool {
  private static instance: MongoConnectionPool;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<void> | null = null;

  static getInstance(): MongoConnectionPool {
    if (!MongoConnectionPool.instance) {
      MongoConnectionPool.instance = new MongoConnectionPool();
    }
    return MongoConnectionPool.instance;
  }

  async connect(): Promise<Db> {
    if (this.db) {
      return this.db;
    }

    if (this.isConnecting && this.connectionPromise) {
      await this.connectionPromise;
      return this.db!;
    }

    this.isConnecting = true;
    this.connectionPromise = this.establishConnection();
    
    try {
      await this.connectionPromise;
      return this.db!;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private async establishConnection(): Promise<void> {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'trade_intelligence_optimized';
    
    this.client = new MongoClient(uri, {
      // Connection pool optimization
      maxPoolSize: 20,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 3000,
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4
      
      // Performance optimizations
      retryWrites: true,
      retryReads: true,
      w: 'majority' as WriteConcern,
      readPreference: 'primaryPreferred',
      
      // Compression
      compressors: ['zstd', 'zlib'],
      zlibCompressionLevel: 6,
    });

    await this.client.connect();
    this.db = this.client.db(dbName);
    
    // Test connection
    await this.db.admin().ping();
    console.log('MongoDB connected with optimized pool');
  }

  getDb(): Db | null {
    return this.db;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}

export class OptimizedDatabaseService {
  private pool = MongoConnectionPool.getInstance();
  private static indexesCreated = false;

  async getCollection(name: string): Promise<Collection> {
    const db = await this.pool.connect();
    
    // Create indexes only once
    if (!OptimizedDatabaseService.indexesCreated) {
      await this.createOptimizedIndexes();
      OptimizedDatabaseService.indexesCreated = true;
    }
    
    return db.collection(name);
  }

  private async createOptimizedIndexes(): Promise<void> {
    const businesses = await this.getCollection('businesses');
    
    // Create indexes in parallel for better performance
    const indexPromises = [
      // Primary geospatial index
      businesses.createIndex({ location: '2dsphere' }, { 
        name: 'geo_location',
        background: true 
      }),
      
      // Compound index for common queries - MOST IMPORTANT
      businesses.createIndex(
        { 
          location: '2dsphere', 
          verificationStatus: 1,
          primaryIndustry: 1,
          'rating': -1
        },
        { 
          name: 'geo_verification_industry_rating',
          background: true,
          partialFilterExpression: { rating: { $exists: true } }
        }
      ),
      
      // Unique constraint on placeId
      businesses.createIndex({ placeId: 1 }, { 
        unique: true, 
        name: 'unique_place_id',
        background: true 
      }),
      
      // TTL index for cache expiry - CRITICAL
      businesses.createIndex({ cacheExpiry: 1 }, { 
        expireAfterSeconds: 0,
        name: 'ttl_cache_expiry',
        background: true 
      }),
      
      // Companies House lookup
      businesses.createIndex({ 'companiesHouseData.companyNumber': 1 }, { 
        sparse: true,
        name: 'ch_company_number',
        background: true 
      }),
      
      // Text search index
      businesses.createIndex(
        { 
          companyName: 'text', 
          'companiesHouseData.officialName': 'text',
          fullAddress: 'text'
        },
        { 
          name: 'text_search',
          background: true,
          weights: {
            companyName: 10,
            'companiesHouseData.officialName': 8,
            fullAddress: 1
          }
        }
      ),
      
      // Performance monitoring index
      businesses.createIndex({ lastUpdated: -1, verificationStatus: 1 }, {
        name: 'updated_verification',
        background: true
      })
    ];

    try {
      await Promise.allSettled(indexPromises);
      console.log('Optimized database indexes created');
    } catch (error) {
      console.error('Index creation failed:', error);
    }
  }

  // Optimized bulk upsert with batching
  async bulkUpsertBusinesses(businesses: BusinessInfo[]): Promise<void> {
    const collection = await this.getCollection('businesses');
    const batchSize = 100; // Optimal batch size for MongoDB
    
    for (let i = 0; i < businesses.length; i += batchSize) {
      const batch = businesses.slice(i, i + batchSize);
      const operations = batch.map(business => ({
        updateOne: {
          filter: { placeId: business.placeId },
          update: { 
            $set: {
              ...business,
              lastUpdated: new Date(),
              cacheExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
          },
          upsert: true
        }
      }));

      try {
        await collection.bulkWrite(operations, { 
          ordered: false, // Allow parallel execution
          writeConcern: { w: 1, j: false } // Faster writes
        });
      } catch (error) {
        console.error(`Bulk upsert failed for batch ${i / batchSize + 1}:`, error);
      }
    }
  }

  // High-performance geospatial query with aggregation pipeline
  async findBusinessesNearOptimized(
    location: Location,
    radius: number,
    filters: {
      businessType?: string;
      verifiedOnly?: boolean;
      limit?: number;
      offset?: number;
      minRating?: number;
    } = {}
  ): Promise<BusinessInfo[]> {
    const collection = await this.getCollection('businesses');
    const { businessType, verifiedOnly, limit = 50, offset = 0, minRating } = filters;
    
    const pipeline: any[] = [
      // Stage 1: Geospatial lookup with index
      {
        $geoNear: {
          near: location,
          distanceField: 'distance',
          maxDistance: radius,
          spherical: true,
          query: {
            // Pre-filter in index scan for better performance
            ...(verifiedOnly && { verificationStatus: 'verified' }),
            ...(businessType && { primaryIndustry: businessType }),
            ...(minRating && { rating: { $gte: minRating } })
          }
        }
      },
      
      // Stage 2: Add computed fields for sorting
      {
        $addFields: {
          sortScore: {
            $add: [
              // Verification bonus
              {
                $switch: {
                  branches: [
                    { case: { $eq: ['$verificationStatus', 'verified'] }, then: 1000 },
                    { case: { $eq: ['$verificationStatus', 'inactive'] }, then: 500 }
                  ],
                  default: 0
                }
              },
              // Rating bonus
              { $multiply: [{ $ifNull: ['$rating', 0] }, 100] },
              // Review count bonus
              { $multiply: [{ $ifNull: ['$totalRatings', 0] }, 0.1] }
            ]
          }
        }
      },
      
      // Stage 3: Sort by computed score and distance
      { $sort: { sortScore: -1, distance: 1 } },
      
      // Stage 4: Pagination
      { $skip: offset },
      { $limit: limit },
      
      // Stage 5: Clean up temporary fields
      {
        $project: {
          distance: 0,
          sortScore: 0,
          _id: 0
        }
      }
    ];

    try {
      const results = await collection.aggregate(pipeline, {
        allowDiskUse: true, // Allow disk usage for large datasets
        maxTimeMS: 10000,   // 10 second timeout
        hint: 'geo_verification_industry_rating' // Use our optimized index
      }).toArray();

      return results as BusinessInfo[];
    } catch (error) {
      console.error('Optimized geospatial query failed:', error);
      throw error;
    }
  }

  // Request deduplication using in-memory cache
  private requestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();
  
  async deduplicatedRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttl: number = 5000
  ): Promise<T> {
    const cached = this.requestCache.get(key);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < ttl) {
      console.log(`Deduplicated request: ${key}`);
      return cached.promise;
    }
    
    const promise = requestFn();
    this.requestCache.set(key, { promise, timestamp: now });
    
    // Cleanup old entries
    setTimeout(() => {
      this.requestCache.delete(key);
    }, ttl);
    
    return promise;
  }

  // Analytics and performance monitoring
  async getPerformanceStats(): Promise<{
    collections: any;
    operations: any;
    connections: any;
  }> {
    const db = await this.pool.connect();
    
    try {
      const [dbStats, serverStatus] = await Promise.all([
        db.stats(),
        db.admin().serverStatus()
      ]);

      return {
        collections: {
          businesses: dbStats.collections || 0,
          totalSize: dbStats.dataSize || 0,
          indexSize: dbStats.indexSize || 0
        },
        operations: {
          queries: serverStatus.opcounters?.query || 0,
          inserts: serverStatus.opcounters?.insert || 0,
          updates: serverStatus.opcounters?.update || 0
        },
        connections: {
          current: serverStatus.connections?.current || 0,
          available: serverStatus.connections?.available || 0,
          totalCreated: serverStatus.connections?.totalCreated || 0
        }
      };
    } catch (error) {
      console.error('Failed to get performance stats:', error);
      return { collections: {}, operations: {}, connections: {} };
    }
  }

  // Memory-efficient cleanup
  async optimizedCleanup(): Promise<{ deletedCount: number; freedBytes: number }> {
    const collection = await this.getCollection('businesses');
    
    try {
      // Get size before cleanup
      const statsBefore = await collection.estimatedDocumentCount();
      
      // Use efficient delete with index
      const deleteResult = await collection.deleteMany(
        { cacheExpiry: { $lt: new Date() } },
        { hint: 'ttl_cache_expiry' }
      );
      
      // Compact collection after cleanup
      const db = await this.pool.connect();
      try {
        await db.admin().command({ compact: 'businesses' });
      } catch (compactError) {
        console.warn('Collection compaction failed:', compactError);
      }
      
      const statsAfter = await collection.estimatedDocumentCount();
      const freedBytes = (statsBefore - statsAfter) * 2048; // Estimate

      return {
        deletedCount: deleteResult.deletedCount,
        freedBytes
      };
    } catch (error) {
      console.error('Optimized cleanup failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}