// Business data types
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
  lastUpdated: string;
  cacheExpiry: string;
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

// API request types
export interface SearchRequest {
  location: string;
  radius: number;
  businessTypes: string[];
  maxResults: number;
  enhanceWithCompaniesHouse: boolean;
  useCache: boolean;
}

// UI types
export interface TradeType {
  value: string;
  label: string;
  icon?: string;
}

export interface SearchFilters {
  location: string;
  radius: number;
  selectedTrades: string[];
  enhanceWithCompaniesHouse: boolean;
  useCache: boolean;
  verifiedOnly: boolean;
}

export interface SearchState {
  isLoading: boolean;
  results: BusinessInfo[];
  hasSearched: boolean;
  error: string | null;
  searchParams: SearchFilters | null;
  executionTime: number;
}

// User and Auth types
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  photoURL: string | null;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Component prop types
export interface BusinessCardProps {
  business: BusinessInfo;
  onViewDetails?: (business: BusinessInfo) => void;
  className?: string;
}

export interface SearchFormProps {
  onSearch: (filters: SearchFilters) => Promise<void>;
  isLoading: boolean;
  className?: string;
}

export interface ResultsTableProps {
  businesses: BusinessInfo[];
  isLoading: boolean;
  onExport?: () => void;
  onSort?: (sortBy: string, direction: 'asc' | 'desc') => void;
  className?: string;
}

// Utility types
export type ViewMode = 'table' | 'cards' | 'list';
export type SortField = 'companyName' | 'rating' | 'verificationStatus' | 'primaryIndustry';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Error types
export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: any;
}

// Export types
export interface ExportConfig {
  format: 'csv' | 'json' | 'xlsx';
  fields: string[];
  filename?: string;
}

// Constants
export const TRADE_TYPES: TradeType[] = [
  { value: 'carpenter', label: 'Carpenters & Joiners' },
  { value: 'builder', label: 'General Builders' },
  { value: 'electrician', label: 'Electricians' },
  { value: 'plumber', label: 'Plumbers' },
  { value: 'roofer', label: 'Roofing Specialists' },
  { value: 'painter', label: 'Decorators' },
  { value: 'landscaper', label: 'Landscapers' },
  { value: 'plasterer', label: 'Plasterers' },
  { value: 'groundworker', label: 'Groundworkers' },
  { value: 'bricklayer', label: 'Bricklayers & Stonemasons' },
  { value: 'heating_engineer', label: 'Heating Engineers' },
  { value: 'kitchen_fitter', label: 'Kitchen Fitters' },
  { value: 'bathroom_fitter', label: 'Bathroom Fitters' },
  { value: 'tiler', label: 'Tilers' },
];

export const RADIUS_OPTIONS = [
  { value: 5, label: '5 miles' },
  { value: 10, label: '10 miles' },
  { value: 20, label: '20 miles' },
  { value: 50, label: '50 miles' },
];

export const RESULTS_PER_PAGE_OPTIONS = [
  { value: 20, label: '20 results' },
  { value: 50, label: '50 results' },
  { value: 100, label: '100 results' },
];