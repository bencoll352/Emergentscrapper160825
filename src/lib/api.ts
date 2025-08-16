import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { SearchRequest, SearchResponse, BusinessInfo } from '@/types';
import { getAuthToken, refreshAuthToken } from './firebase';
import toast from 'react-hot-toast';

// Create axios instance with default configuration
const createApiClient = (): AxiosInstance => {
  const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5001';
  
  const client = axios.create({
    baseURL,
    timeout: 30000, // 30 seconds
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor to add auth token
  client.interceptors.request.use(
    async (config) => {
      // Add auth token if user is authenticated
      const token = await getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Add request timestamp for debugging
      config.metadata = { startTime: Date.now() };
      
      console.log(`🚀 API Request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    },
    (error) => {
      console.error('❌ Request interceptor error:', error);
      return Promise.reject(error);
    }
  );

  // Response interceptor for error handling and retries
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      // Log response time
      const duration = Date.now() - response.config.metadata?.startTime;
      console.log(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`);
      
      return response;
    },
    async (error) => {
      const originalRequest = error.config;
      const duration = Date.now() - (originalRequest?.metadata?.startTime || 0);
      
      console.error(`❌ API Error: ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url} (${duration}ms)`, error.response?.data || error.message);

      // Handle token refresh for 401 errors
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        
        try {
          const newToken = await refreshAuthToken();
          if (newToken) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return client(originalRequest);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          // Redirect to login or show auth error
        }
      }

      // Handle rate limiting with exponential backoff
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60');
        
        toast.error(`Rate limit exceeded. Please wait ${retryAfter} seconds.`, {
          duration: retryAfter * 1000,
        });
        
        // Optional: Implement exponential backoff retry
        if (!originalRequest._retryCount) {
          originalRequest._retryCount = 0;
        }
        
        if (originalRequest._retryCount < 3) {
          originalRequest._retryCount++;
          const delay = Math.pow(2, originalRequest._retryCount) * 1000; // Exponential backoff
          
          return new Promise(resolve => {
            setTimeout(() => resolve(client(originalRequest)), delay);
          });
        }
      }

      // Transform error for consistent handling
      const apiError = {
        message: error.response?.data?.error || error.message || 'An unexpected error occurred',
        code: error.response?.data?.code || error.code,
        statusCode: error.response?.status,
        details: error.response?.data?.details
      };

      return Promise.reject(apiError);
    }
  );

  return client;
};

// Create singleton API client
const api = createApiClient();

// API methods
export const apiClient = {
  // Health check
  healthCheck: async (): Promise<any> => {
    const response = await api.get('/health');
    return response.data;
  },

  // Search businesses
  searchBusinesses: async (searchRequest: SearchRequest): Promise<SearchResponse> => {
    const response = await api.post('/search-businesses', searchRequest);
    return response.data;
  },

  // Get cached businesses
  getCachedBusinesses: async (params: {
    lat: number;
    lng: number;
    radius?: number;
    businessType?: string;
    verifiedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ businesses: BusinessInfo[]; totalFound: number }> => {
    const response = await api.get('/cached-businesses', { params });
    return response.data;
  },

  // Get company details from Companies House
  getCompanyDetails: async (companyNumber: string): Promise<any> => {
    const response = await api.get(`/company/${companyNumber}`);
    return response.data;
  },

  // Search companies in Companies House
  searchCompanies: async (query: string, itemsPerPage?: number): Promise<any> => {
    const response = await api.get('/search/companies', {
      params: { query, itemsPerPage }
    });
    return response.data;
  }
};

// Utility functions for API requests
export const withRetry = async <T>(
  apiCall: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on client errors (4xx) except 429
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
        throw error;
      }
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
};

// Batch API requests with concurrency control
export const batchRequests = async <T, R>(
  items: T[],
  requestFn: (item: T) => Promise<R>,
  batchSize: number = 5
): Promise<R[]> => {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map(requestFn);
    
    try {
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Batch request failed:', result.reason);
          // You might want to push null or handle failed requests differently
        }
      }
    } catch (error) {
      console.error('Batch processing error:', error);
    }
    
    // Add delay between batches to be nice to the API
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
};

// API request cache
const requestCache = new Map<string, { data: any; timestamp: number; ttl: number }>();

export const cachedApiCall = async <T>(
  cacheKey: string,
  apiCall: () => Promise<T>,
  ttl: number = 5 * 60 * 1000 // 5 minutes default
): Promise<T> => {
  const cached = requestCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    console.log(`🎯 Cache HIT: ${cacheKey}`);
    return cached.data;
  }
  
  console.log(`🎯 Cache MISS: ${cacheKey}`);
  const data = await apiCall();
  
  requestCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl
  });
  
  return data;
};

// Clear cache
export const clearApiCache = (pattern?: string): void => {
  if (pattern) {
    for (const key of requestCache.keys()) {
      if (key.includes(pattern)) {
        requestCache.delete(key);
      }
    }
  } else {
    requestCache.clear();
  }
};