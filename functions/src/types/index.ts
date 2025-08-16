import { z } from 'zod';

// Input validation schemas
export const BusinessSearchSchema = z.object({
  location: z.string().min(2).max(100),
  radius: z.number().min(1000).max(80000).default(20000),
  businessTypes: z.array(z.string()).min(1).max(10),
  maxResults: z.number().min(1).max(100).default(50),
  enhanceWithCompaniesHouse: z.boolean().default(true),
  useCache: z.boolean().default(true)
});

export const CachedBusinessesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius: z.number().min(1000).max(80000).default(20000),
  businessType: z.string().optional(),
  verifiedOnly: z.boolean().default(false),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0)
});

// Business data interfaces
export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface CompaniesHouseData {
  companyNumber?: string;
  officialName?: string;
  companyStatus?: string;
  registeredAddress?: {
    addressLine1?: string;
    locality?: string;
    postalCode?: string;
    country?: string;
  };
  sicCodes?: string[];
  directors?: Array<{
    name: string;
    role: string;
    appointedOn?: string;
  }>;
  incorporationDate?: string;
}

export interface BusinessInfo {
  placeId: string;
  companyName: string;
  tradespersonName?: string;
  primaryIndustry: string;
  fullAddress: string;
  postcode?: string;
  websiteUrl?: string;
  phoneNumber?: string;
  emailAddress?: string;
  sourceUrl: string;
  dateOfScraping: string;
  rating?: number;
  totalRatings?: number;
  location: Location;
  companiesHouseData?: CompaniesHouseData;
  verificationStatus: 'verified' | 'inactive' | 'unverified';
  lastUpdated: Date;
  cacheExpiry: Date;
}

export interface SearchResponse {
  success: boolean;
  totalFound: number;
  businesses: BusinessInfo[];
  searchLocation: {
    lat: number;
    lng: number;
  };
  searchParams: {
    location: string;
    radius: number;
    businessTypes: string[];
    maxResults: number;
  };
  fromCache: boolean;
  executionTime: number;
}

// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime?: number;
  fromCache?: boolean;
}

// Google Places API types
export interface GooglePlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

// Companies House API types
export interface CompaniesHouseSearchResult {
  company_number: string;
  title: string;
  company_status: string;
  address: {
    postal_code?: string;
    address_line_1?: string;
    locality?: string;
  };
}

export interface CompaniesHouseProfile {
  company_number: string;
  company_name: string;
  company_status: string;
  registered_office_address: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
  date_of_creation?: string;
}

export interface CompaniesHouseOfficer {
  name: string;
  officer_role: string;
  appointed_on?: string;
}

// Trade type mappings
export const TRADE_TYPE_MAPPING: Record<string, { googleType: string; keyword: string; industry: string }> = {
  carpenter: {
    googleType: 'general_contractor',
    keyword: 'carpenter joiner',
    industry: 'Carpenters & Joiners'
  },
  builder: {
    googleType: 'general_contractor',
    keyword: 'builder construction',
    industry: 'General Builders'
  },
  electrician: {
    googleType: 'electrician',
    keyword: 'electrician electrical contractor',
    industry: 'Electricians'
  },
  plumber: {
    googleType: 'plumber',
    keyword: 'plumber plumbing services',
    industry: 'Plumbers'
  },
  roofer: {
    googleType: 'roofing_contractor',
    keyword: 'roofer roofing services',
    industry: 'Roofing Specialists'
  },
  painter: {
    googleType: 'painter',
    keyword: 'painter decorator',
    industry: 'Decorators'
  },
  landscaper: {
    googleType: 'general_contractor',
    keyword: 'landscaper gardening',
    industry: 'Landscapers'
  },
  plasterer: {
    googleType: 'general_contractor',
    keyword: 'plasterer plastering services',
    industry: 'Plasterers'
  },
  groundworker: {
    googleType: 'general_contractor',
    keyword: 'groundwork excavation',
    industry: 'Groundworkers'
  },
  bricklayer: {
    googleType: 'general_contractor',
    keyword: 'bricklayer masonry',
    industry: 'Bricklayers & Stonemasons'
  },
  heating_engineer: {
    googleType: 'plumber',
    keyword: 'heating engineer boiler',
    industry: 'Heating Engineers'
  },
  kitchen_fitter: {
    googleType: 'general_contractor',
    keyword: 'kitchen fitter',
    industry: 'Kitchen Fitters'
  },
  bathroom_fitter: {
    googleType: 'general_contractor',
    keyword: 'bathroom fitter',
    industry: 'Property Maintenance'
  },
  tiler: {
    googleType: 'general_contractor',
    keyword: 'tiler tiling services',
    industry: 'Tilers'
  },
  decorator: {
    googleType: 'painter',
    keyword: 'decorator painting services',
    industry: 'Decorators'
  }
};

// Cache configuration
export const CACHE_CONFIG = {
  BUSINESS_SEARCH_TTL: 24 * 60 * 60 * 1000, // 24 hours
  COMPANIES_HOUSE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  POSTCODE_LOOKUP_TTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  MAX_CACHE_SIZE: 10000,
  CLEANUP_INTERVAL: 6 * 60 * 60 * 1000 // 6 hours
};

// Error types
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, public details?: any) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ExternalApiError extends ApiError {
  constructor(message: string, public service: string, public originalError?: any) {
    super(503, message, 'EXTERNAL_API_ERROR');
    this.name = 'ExternalApiError';
  }
}