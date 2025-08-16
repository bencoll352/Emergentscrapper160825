import { MongoClient, Db, Collection, CreateIndexesOptions } from 'mongodb';
import { BusinessInfo, Location } from '../types';

export class DatabaseService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private static instance: DatabaseService;

  constructor() {
    if (DatabaseService.instance) {
      return DatabaseService.instance;
    }
    DatabaseService.instance = this;
  }

  async connect(): Promise<void> {
    if (this.client && this.db) {
      return;
    }

    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      const dbName = process.env.MONGODB_DB_NAME || 'trade_intelligence_optimized';
      
      this.client = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        maxIdleTimeMS: 30000,
        retryWrites: true,
        retryReads: true
      });

      await this.client.connect();
      this.db = this.client.db(dbName);
      
      // Create optimized indexes
      await this.createIndexes();
      
      console.log('Connected to MongoDB successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    if (!this.db) return;

    const businesses = this.db.collection('businesses');
    
    // Compound indexes for common query patterns
    const indexes = [
      // Geospatial index for location-based searches
      { key: { location: '2dsphere' } },
      
      // Compound index for filtered searches
      { 
        key: { 
          location: '2dsphere', 
          primaryIndustry: 1, 
          verificationStatus: 1 
        },
        name: 'location_industry_verification'
      },
      
      // Index for place_id uniqueness and fast lookups
      { key: { placeId: 1 }, unique: true },
      
      // Index for Companies House data queries
      { key: { 'companiesHouseData.companyNumber': 1 }, sparse: true },
      
      // TTL index for automatic cache cleanup
      { 
        key: { cacheExpiry: 1 }, 
        expireAfterSeconds: 0,
        name: 'cache_expiry_ttl'
      },
      
      // Index for verification status queries
      { key: { verificationStatus: 1, lastUpdated: -1 } },
      
      // Text index for company name searches
      { 
        key: { 
          companyName: 'text', 
          'companiesHouseData.officialName': 'text' 
        },
        name: 'company_name_text'
      }
    ];

    for (const index of indexes) {
      try {
        await businesses.createIndex(index.key, {
          name: index.name,
          unique: index.unique,
          sparse: index.sparse,
          expireAfterSeconds: index.expireAfterSeconds
        } as CreateIndexesOptions);
      } catch (error) {
        console.warn(`Failed to create index ${index.name}:`, error);
      }
    }
  }

  async upsertBusiness(business: BusinessInfo): Promise<void> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    
    try {
      await businesses.updateOne(
        { placeId: business.placeId },
        { 
          $set: {
            ...business,
            lastUpdated: new Date(),
            cacheExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
          }
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Failed to upsert business:', error);
      throw error;
    }
  }

  async findBusinessesNear(
    location: Location,
    radius: number,
    filters: {
      businessType?: string;
      verifiedOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<BusinessInfo[]> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    const { businessType, verifiedOnly, limit = 50, offset = 0 } = filters;
    
    try {
      const pipeline: any[] = [
        // Geospatial match
        {
          $geoNear: {
            near: location,
            distanceField: 'distance',
            maxDistance: radius,
            spherical: true
          }
        }
      ];

      // Add filters
      const matchFilters: any = {};
      if (businessType) {
        matchFilters.primaryIndustry = businessType;
      }
      if (verifiedOnly) {
        matchFilters.verificationStatus = 'verified';
      }
      
      if (Object.keys(matchFilters).length > 0) {
        pipeline.push({ $match: matchFilters });
      }

      // Sort by verification status (verified first) then by distance
      pipeline.push({
        $addFields: {
          sortPriority: {
            $switch: {
              branches: [
                { case: { $eq: ['$verificationStatus', 'verified'] }, then: 1 },
                { case: { $eq: ['$verificationStatus', 'inactive'] }, then: 2 }
              ],
              default: 3
            }
          }
        }
      });

      pipeline.push({
        $sort: { sortPriority: 1, distance: 1 }
      });

      // Pagination
      pipeline.push({ $skip: offset });
      pipeline.push({ $limit: limit });

      // Remove temporary fields
      pipeline.push({
        $project: {
          distance: 0,
          sortPriority: 0,
          _id: 0
        }
      });

      const results = await businesses.aggregate(pipeline).toArray();
      return results as BusinessInfo[];
    } catch (error) {
      console.error('Failed to find businesses near location:', error);
      throw error;
    }
  }

  async findBusinessByPlaceId(placeId: string): Promise<BusinessInfo | null> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    
    try {
      const result = await businesses.findOne({ placeId }, { projection: { _id: 0 } });
      return result as BusinessInfo | null;
    } catch (error) {
      console.error('Failed to find business by place ID:', error);
      throw error;
    }
  }

  async searchBusinessesByName(query: string, limit: number = 20): Promise<BusinessInfo[]> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    
    try {
      const results = await businesses.find(
        { $text: { $search: query } },
        { 
          projection: { _id: 0, score: { $meta: 'textScore' } },
          sort: { score: { $meta: 'textScore' } },
          limit
        }
      ).toArray();
      
      return results.map(r => {
        const { score, ...business } = r;
        return business as BusinessInfo;
      });
    } catch (error) {
      console.error('Failed to search businesses by name:', error);
      throw error;
    }
  }

  async getBusinessStats(location?: Location, radius?: number): Promise<{
    total: number;
    verified: number;
    byIndustry: Record<string, number>;
  }> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    
    try {
      const pipeline: any[] = [];
      
      if (location && radius) {
        pipeline.push({
          $geoNear: {
            near: location,
            distanceField: 'distance',
            maxDistance: radius,
            spherical: true
          }
        });
      }

      pipeline.push({
        $facet: {
          total: [{ $count: 'count' }],
          verified: [
            { $match: { verificationStatus: 'verified' } },
            { $count: 'count' }
          ],
          byIndustry: [
            { $group: { _id: '$primaryIndustry', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ]
        }
      });

      const [result] = await businesses.aggregate(pipeline).toArray();
      
      return {
        total: result.total[0]?.count || 0,
        verified: result.verified[0]?.count || 0,
        byIndustry: result.byIndustry.reduce((acc: any, item: any) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('Failed to get business stats:', error);
      throw error;
    }
  }

  async cleanupExpiredData(): Promise<{ deletedCount: number }> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    
    try {
      const result = await businesses.deleteMany({
        cacheExpiry: { $lt: new Date() }
      });
      
      console.log(`Cleaned up ${result.deletedCount} expired business records`);
      return { deletedCount: result.deletedCount };
    } catch (error) {
      console.error('Failed to cleanup expired data:', error);
      throw error;
    }
  }

  async updateCacheExpiry(placeIds: string[], ttl: number): Promise<void> {
    if (!this.db) await this.connect();
    
    const businesses = this.db!.collection('businesses');
    const cacheExpiry = new Date(Date.now() + ttl);
    
    try {
      await businesses.updateMany(
        { placeId: { $in: placeIds } },
        { 
          $set: { 
            cacheExpiry,
            lastUpdated: new Date()
          }
        }
      );
    } catch (error) {
      console.error('Failed to update cache expiry:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}