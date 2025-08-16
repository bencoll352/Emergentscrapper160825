import axios, { AxiosInstance } from 'axios';
import pLimit from 'p-limit';
import { 
  CompaniesHouseSearchResult, 
  CompaniesHouseProfile, 
  CompaniesHouseOfficer,
  CompaniesHouseData,
  ExternalApiError 
} from '../types';
import { CacheService } from './cache';

export class CompaniesHouseService {
  private client: AxiosInstance;
  private cache: CacheService;
  private rateLimiter = pLimit(3); // Companies House has stricter rate limits
  private static instance: CompaniesHouseService;

  constructor() {
    if (CompaniesHouseService.instance) {
      return CompaniesHouseService.instance;
    }

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      throw new Error('COMPANIES_HOUSE_API_KEY environment variable is required');
    }

    this.client = axios.create({
      baseURL: 'https://api.company-information.service.gov.uk',
      timeout: 15000,
      auth: {
        username: apiKey,
        password: ''
      },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'UK-Trade-Intelligence/1.0'
      }
    });

    this.cache = new CacheService();
    CompaniesHouseService.instance = this;
  }

  async searchCompanies(query: string, maxResults: number = 10): Promise<CompaniesHouseSearchResult[]> {
    const cacheKey = `ch_search_${query.toLowerCase().replace(/\s+/g, '_')}`;
    
    // Check cache first
    const cached = await this.cache.getCompanyData(cacheKey);
    if (cached) {
      console.log(`Companies House search cache HIT: ${query}`);
      return cached;
    }

    try {
      const response = await this.rateLimiter(() =>
        this.client.get('/search/companies', {
          params: {
            q: query,
            items_per_page: Math.min(maxResults, 100),
            start_index: 0
          }
        })
      );

      const results = response.data.items || [];
      
      // Cache the results
      await this.cache.setCompanyData(cacheKey, results);
      
      console.log(`Companies House search: Found ${results.length} companies for "${query}"`);
      return results;

    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new ExternalApiError(
          'Companies House API rate limit exceeded',
          'CompaniesHouse'
        );
      }
      
      throw new ExternalApiError(
        `Failed to search companies: ${error.message}`,
        'CompaniesHouse',
        error
      );
    }
  }

  async getCompanyProfile(companyNumber: string): Promise<CompaniesHouseProfile | null> {
    // Check cache first
    const cached = await this.cache.getCompanyData(companyNumber);
    if (cached) {
      console.log(`Company profile cache HIT: ${companyNumber}`);
      return cached;
    }

    try {
      const response = await this.rateLimiter(() =>
        this.client.get(`/company/${companyNumber}`)
      );

      const profile = response.data;
      
      // Cache the profile
      await this.cache.setCompanyData(companyNumber, profile);
      
      console.log(`Company profile fetched: ${companyNumber} - ${profile.company_name}`);
      return profile;

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`Company not found: ${companyNumber}`);
        return null;
      }
      
      if (error.response?.status === 429) {
        throw new ExternalApiError(
          'Companies House API rate limit exceeded',
          'CompaniesHouse'
        );
      }
      
      throw new ExternalApiError(
        `Failed to get company profile: ${error.message}`,
        'CompaniesHouse',
        error
      );
    }
  }

  async getCompanyOfficers(companyNumber: string): Promise<CompaniesHouseOfficer[]> {
    const cacheKey = `${companyNumber}_officers`;
    
    // Check cache first
    const cached = await this.cache.getCompanyData(cacheKey);
    if (cached) {
      console.log(`Company officers cache HIT: ${companyNumber}`);
      return cached;
    }

    try {
      const response = await this.rateLimiter(() =>
        this.client.get(`/company/${companyNumber}/officers`, {
          params: {
            items_per_page: 10, // Limit officers for performance
            start_index: 0
          }
        })
      );

      const officers = response.data.items || [];
      
      // Cache the officers
      await this.cache.setCompanyData(cacheKey, officers);
      
      console.log(`Company officers fetched: ${companyNumber} - ${officers.length} officers`);
      return officers;

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`Officers not found for company: ${companyNumber}`);
        return [];
      }
      
      if (error.response?.status === 429) {
        throw new ExternalApiError(
          'Companies House API rate limit exceeded',
          'CompaniesHouse'
        );
      }
      
      throw new ExternalApiError(
        `Failed to get company officers: ${error.message}`,
        'CompaniesHouse',
        error
      );
    }
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    // Normalize names by removing common suffixes and punctuation
    const normalize = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(ltd|limited|plc|llp|company|co|limited liability partnership)\b/g, '')
        .trim();
    };

    const normalized1 = normalize(name1);
    const normalized2 = normalize(name2);

    // Simple word overlap calculation
    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  async enhanceBusinessData(
    businessName: string, 
    postcode?: string,
    address?: string
  ): Promise<CompaniesHouseData | null> {
    try {
      // Search for companies with similar names
      const companies = await this.searchCompanies(businessName, 20);
      
      if (companies.length === 0) {
        console.log(`No Companies House matches found for: ${businessName}`);
        return null;
      }

      // Find best matching company using multiple criteria
      let bestMatch: CompaniesHouseSearchResult | null = null;
      let bestScore = 0;

      for (const company of companies) {
        let score = this.calculateNameSimilarity(businessName, company.title);
        
        // Bonus points for postcode match
        if (postcode && company.address?.postal_code) {
          const companyPostcode = company.address.postal_code.replace(/\s+/g, '').toUpperCase();
          const searchPostcode = postcode.replace(/\s+/g, '').toUpperCase();
          
          if (companyPostcode === searchPostcode) {
            score += 0.3; // Strong postcode match
          } else if (companyPostcode.substring(0, 4) === searchPostcode.substring(0, 4)) {
            score += 0.1; // Partial postcode match
          }
        }

        // Bonus for active status
        if (company.company_status === 'active') {
          score += 0.05;
        }

        if (score > bestScore && score > 0.4) { // Minimum 40% similarity
          bestMatch = company;
          bestScore = score;
        }
      }

      if (!bestMatch) {
        console.log(`No suitable Companies House match found for: ${businessName} (best score: ${bestScore})`);
        return null;
      }

      console.log(`Companies House match found: ${bestMatch.title} (score: ${bestScore.toFixed(2)})`);

      // Get detailed profile and officers in parallel
      const [profile, officers] = await Promise.allSettled([
        this.getCompanyProfile(bestMatch.company_number),
        this.getCompanyOfficers(bestMatch.company_number)
      ]);

      if (profile.status === 'rejected' || !profile.value) {
        console.log(`Failed to get profile for company: ${bestMatch.company_number}`);
        return null;
      }

      // Process officers data (handle rejection gracefully)
      const directorsData = officers.status === 'fulfilled' && officers.value
        ? officers.value.slice(0, 5).map(officer => ({
            name: officer.name || '',
            role: officer.officer_role || '',
            appointedOn: officer.appointed_on || ''
          }))
        : [];

      return {
        companyNumber: bestMatch.company_number,
        officialName: profile.value.company_name,
        companyStatus: profile.value.company_status,
        registeredAddress: profile.value.registered_office_address,
        sicCodes: profile.value.sic_codes || [],
        directors: directorsData,
        incorporationDate: profile.value.date_of_creation
      };

    } catch (error: any) {
      console.error(`Error enhancing business data for "${businessName}":`, error);
      
      // Don't throw error - return null to gracefully handle Companies House failures
      if (error instanceof ExternalApiError) {
        console.warn(`Companies House API error: ${error.message}`);
      }
      
      return null;
    }
  }

  async batchEnhanceBusinesses(
    businesses: Array<{
      name: string;
      postcode?: string;
      address?: string;
    }>
  ): Promise<Array<CompaniesHouseData | null>> {
    console.log(`Batch enhancing ${businesses.length} businesses with Companies House data`);

    // Process in smaller batches to respect rate limits
    const batchSize = 3; // Conservative batch size
    const results: Array<CompaniesHouseData | null> = [];

    for (let i = 0; i < businesses.length; i += batchSize) {
      const batch = businesses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(business =>
        this.rateLimiter(() => 
          this.enhanceBusinessData(business.name, business.postcode, business.address)
        )
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results, handling any rejections
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Batch enhancement error:', result.reason);
          results.push(null);
        }
      }

      // Small delay between batches to be respectful to the API
      if (i + batchSize < businesses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const enhancedCount = results.filter(r => r !== null).length;
    console.log(`Batch enhancement complete: ${enhancedCount}/${businesses.length} enhanced`);

    return results;
  }

  // Get rate limiter stats
  getRateLimiterStats(): { pending: number; active: number } {
    return {
      pending: this.rateLimiter.pendingCount,
      active: this.rateLimiter.activeCount
    };
  }

  // Validate company status
  isActiveCompany(companyData: CompaniesHouseData): boolean {
    return companyData.companyStatus === 'active';
  }

  // Extract SIC code descriptions
  getSicCodeDescriptions(sicCodes: string[]): string[] {
    // This could be enhanced with a full SIC code lookup table
    const commonSicCodes: { [code: string]: string } = {
      '41100': 'Development of building projects',
      '41200': 'Construction of residential and non-residential buildings',
      '42110': 'Construction of roads and motorways',
      '42120': 'Construction of railways and underground railways',
      '42130': 'Construction of bridges and tunnels',
      '42210': 'Construction of utility projects for fluids',
      '42220': 'Construction of utility projects for electricity and telecommunications',
      '42910': 'Construction of water projects',
      '42990': 'Construction of other civil engineering projects',
      '43110': 'Demolition',
      '43120': 'Site preparation',
      '43130': 'Test drilling and boring',
      '43210': 'Electrical installation',
      '43220': 'Plumbing, heat and air-conditioning installation',
      '43290': 'Other construction installation',
      '43310': 'Plastering',
      '43320': 'Joinery installation',
      '43330': 'Floor and wall covering',
      '43340': 'Painting and glazing',
      '43390': 'Other building completion and finishing',
      '43910': 'Roofing activities',
      '43990': 'Other specialised construction activities'
    };

    return sicCodes.map(code => 
      commonSicCodes[code] || `SIC Code ${code}`
    );
  }
}