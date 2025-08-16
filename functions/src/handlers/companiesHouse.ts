import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError, ValidationError } from '../types';
import { CompaniesHouseService } from '../services/companiesHouse';
import { asyncHandler } from '../middleware/errorHandler';

// Validation schemas
const CompanyNumberSchema = z.string().regex(/^[A-Z0-9]{8}$/i, 'Invalid company number format');
const SearchQuerySchema = z.object({
  query: z.string().min(2).max(100),
  itemsPerPage: z.number().min(1).max(100).default(20)
});

export const companiesHouseHandler = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const companiesHouse = new CompaniesHouseService();

    // Handle different endpoints based on path and method
    if (req.method === 'GET' && req.params.companyNumber) {
      // GET /company/:companyNumber - Get company details
      await handleGetCompanyDetails(req, res, companiesHouse, startTime);
    } else if (req.method === 'GET' && req.path.includes('/search/companies')) {
      // GET /search/companies - Search companies
      await handleSearchCompanies(req, res, companiesHouse, startTime);
    } else {
      throw new ApiError(404, 'Endpoint not found');
    }

  } catch (error) {
    console.error('Companies House handler error:', error);
    
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }

    throw new ApiError(500, `Companies House request failed: ${error.message}`);
  }
});

async function handleGetCompanyDetails(
  req: Request,
  res: Response,
  companiesHouse: CompaniesHouseService,
  startTime: number
) {
  const { companyNumber } = req.params;
  
  // Validate company number
  const validationResult = CompanyNumberSchema.safeParse(companyNumber);
  if (!validationResult.success) {
    throw new ValidationError('Invalid company number format', validationResult.error.errors);
  }

  const validCompanyNumber = validationResult.data.toUpperCase();
  
  console.log(`Fetching company details for: ${validCompanyNumber}`);

  try {
    // Get company profile and officers in parallel
    const [profile, officers] = await Promise.allSettled([
      companiesHouse.getCompanyProfile(validCompanyNumber),
      companiesHouse.getCompanyOfficers(validCompanyNumber)
    ]);

    // Handle profile result
    if (profile.status === 'rejected') {
      throw new ApiError(503, 'Failed to fetch company profile');
    }

    if (!profile.value) {
      throw new ApiError(404, `Company not found: ${validCompanyNumber}`);
    }

    // Handle officers result (don't fail if officers can't be fetched)
    const officersData = officers.status === 'fulfilled' ? officers.value : [];
    if (officers.status === 'rejected') {
      console.warn(`Failed to fetch officers for ${validCompanyNumber}:`, officers.reason);
    }

    const executionTime = Date.now() - startTime;

    console.log(`Company details fetched in ${executionTime}ms`);

    res.json({
      success: true,
      company: profile.value,
      officers: officersData,
      executionTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, `Failed to fetch company details: ${error.message}`);
  }
}

async function handleSearchCompanies(
  req: Request,
  res: Response,
  companiesHouse: CompaniesHouseService,
  startTime: number
) {
  // Validate query parameters
  const validationResult = SearchQuerySchema.safeParse({
    query: req.query.query as string,
    itemsPerPage: req.query.itemsPerPage ? parseInt(req.query.itemsPerPage as string) : undefined
  });

  if (!validationResult.success) {
    throw new ValidationError('Invalid search parameters', validationResult.error.errors);
  }

  const { query, itemsPerPage } = validationResult.data;

  console.log(`Searching companies for: "${query}" (limit: ${itemsPerPage})`);

  try {
    const companies = await companiesHouse.searchCompanies(query, itemsPerPage);
    
    const executionTime = Date.now() - startTime;

    console.log(`Found ${companies.length} companies in ${executionTime}ms`);

    // Enhance results with additional metadata
    const enhancedResults = companies.map(company => ({
      ...company,
      isActive: company.company_status === 'active',
      hasPostcode: !!company.address?.postal_code,
      searchScore: calculateSearchScore(query, company.title, company.company_status)
    }));

    // Sort by search score (active companies first, then by relevance)
    enhancedResults.sort((a, b) => b.searchScore - a.searchScore);

    res.json({
      success: true,
      totalFound: companies.length,
      companies: enhancedResults,
      searchQuery: query,
      executionTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, `Company search failed: ${error.message}`);
  }
}

function calculateSearchScore(query: string, companyName: string, status: string): number {
  let score = 0;
  
  const queryLower = query.toLowerCase();
  const nameLower = companyName.toLowerCase();
  
  // Exact match bonus
  if (nameLower === queryLower) {
    score += 100;
  } else if (nameLower.startsWith(queryLower)) {
    score += 50;
  } else if (nameLower.includes(queryLower)) {
    score += 25;
  }
  
  // Word match bonus
  const queryWords = queryLower.split(/\s+/);
  const nameWords = nameLower.split(/\s+/);
  
  for (const queryWord of queryWords) {
    if (queryWord.length < 3) continue; // Skip short words
    
    for (const nameWord of nameWords) {
      if (nameWord === queryWord) {
        score += 10;
      } else if (nameWord.startsWith(queryWord)) {
        score += 5;
      }
    }
  }
  
  // Status bonus
  if (status === 'active') {
    score += 20;
  }
  
  return score;
}