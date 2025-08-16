import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  MagnifyingGlassIcon, 
  BuildingOffice2Icon, 
  MapPinIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { SearchFilters, BusinessInfo, SearchResponse } from '@/types';
import { apiClient } from '@/lib/api';
import SearchForm from './SearchForm';
import BusinessResults from './BusinessResults';
import LoadingSpinner from './ui/LoadingSpinner';
import toast from 'react-hot-toast';

const SearchInterface: React.FC = () => {
  const [searchFilters, setSearchFilters] = useState<SearchFilters | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const queryClient = useQueryClient();

  // Search mutation with React Query
  const searchMutation = useMutation({
    mutationFn: async (filters: SearchFilters): Promise<SearchResponse> => {
      return apiClient.searchBusinesses({
        location: filters.location,
        radius: filters.radius * 1609.34, // Convert miles to meters
        businessTypes: filters.selectedTrades,
        maxResults: 50,
        enhanceWithCompaniesHouse: filters.enhanceWithCompaniesHouse,
        useCache: filters.useCache
      });
    },
    onSuccess: (data) => {
      const verifiedCount = data.businesses.filter(b => b.verificationStatus === 'verified').length;
      toast.success(
        `Found ${data.businesses.length} businesses (${verifiedCount} verified) in ${data.executionTime}ms`,
        { duration: 5000 }
      );

      // Cache the results for future queries
      queryClient.setQueryData(['businesses', searchFilters], data);
    },
    onError: (error: any) => {
      console.error('Search error:', error);
      toast.error(error.message || 'Search failed. Please try again.');
    }
  });

  // Handle search with validation
  const handleSearch = useCallback(async (filters: SearchFilters) => {
    if (!filters.location.trim()) {
      toast.error('Please enter a location');
      return;
    }

    if (filters.selectedTrades.length === 0) {
      toast.error('Please select at least one trade type');
      return;
    }

    setSearchFilters(filters);
    searchMutation.mutate(filters);
  }, [searchMutation]);

  // Export to CSV with optimization
  const handleExport = useCallback(async () => {
    if (!searchMutation.data?.businesses?.length) {
      toast.error('No data to export');
      return;
    }

    try {
      const businesses = searchMutation.data.businesses;
      const headers = [
        'Company Name',
        'Primary Industry',
        'Full Address',
        'Postcode',
        'Phone Number',
        'Website URL',
        'Rating',
        'Total Ratings',
        'Verification Status',
        'Company Number',
        'Company Status',
        'SIC Codes',
        'Directors Count',
        'Date Scraped'
      ];

      const csvContent = [
        headers.join(','),
        ...businesses.map(business =>
          [
            `"${business.companyName || ''}"`,
            `"${business.primaryIndustry || ''}"`,
            `"${business.fullAddress || ''}"`,
            `"${business.postcode || ''}"`,
            `"${business.phoneNumber || ''}"`,
            `"${business.websiteUrl || ''}"`,
            `"${business.rating || ''}"`,
            `"${business.totalRatings || ''}"`,
            `"${business.verificationStatus || ''}"`,
            `"${business.companiesHouseData?.companyNumber || ''}"`,
            `"${business.companiesHouseData?.companyStatus || ''}"`,
            `"${business.companiesHouseData?.sicCodes?.join('; ') || ''}"`,
            `"${business.companiesHouseData?.directors?.length || ''}"`,
            `"${business.dateOfScraping || ''}"`
          ].join(',')
        )
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `trade_contacts_${searchFilters?.location?.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      
      URL.revokeObjectURL(link.href);
      toast.success(`Exported ${businesses.length} contacts to CSV`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    }
  }, [searchMutation.data, searchFilters]);

  // Memoized statistics
  const statistics = useMemo(() => {
    const businesses = searchMutation.data?.businesses || [];
    return {
      total: businesses.length,
      verified: businesses.filter(b => b.verificationStatus === 'verified').length,
      hasWebsite: businesses.filter(b => b.websiteUrl).length,
      hasPhone: businesses.filter(b => b.phoneNumber).length,
      avgRating: businesses.reduce((acc, b) => acc + (b.rating || 0), 0) / businesses.length || 0
    };
  }, [searchMutation.data]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-3 rounded-xl shadow-lg">
                <BuildingOffice2Icon className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  UK Trade Intelligence
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Find verified construction professionals with Companies House data
                </p>
              </div>
            </div>
            
            {/* Quick stats */}
            {statistics.total > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="hidden md:flex items-center space-x-6 text-sm"
              >
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{statistics.total}</div>
                  <div className="text-gray-500">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{statistics.verified}</div>
                  <div className="text-gray-500">Verified</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{statistics.avgRating.toFixed(1)}</div>
                  <div className="text-gray-500">Avg Rating</div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </motion.header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <SearchForm
            onSearch={handleSearch}
            isLoading={searchMutation.isPending}
            className="mb-8"
          />
        </motion.div>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {searchMutation.isPending && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <LoadingSpinner size="large" />
              <p className="mt-4 text-lg text-gray-600">
                Searching UK trade professionals...
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Enhanced with Companies House verification
              </p>
            </motion.div>
          )}

          {searchMutation.data && !searchMutation.isPending && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Results Header */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center space-x-3">
                    <CheckCircleIcon className="h-6 w-6 text-green-500" />
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        Search Results ({statistics.total})
                      </h2>
                      <p className="text-sm text-gray-600">
                        Found in {searchMutation.data.executionTime}ms • 
                        {statistics.verified} verified • 
                        {searchFilters?.location} ({searchFilters?.radius} miles)
                        {searchMutation.data.fromCache && (
                          <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                            Cached
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center space-x-3 mt-4 sm:mt-0">
                    {/* View Mode Toggle */}
                    <div className="flex rounded-lg border border-gray-300 p-1">
                      <button
                        onClick={() => setViewMode('cards')}
                        className={`px-3 py-1 text-sm rounded ${
                          viewMode === 'cards'
                            ? 'bg-blue-100 text-blue-700'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Cards
                      </button>
                      <button
                        onClick={() => setViewMode('table')}
                        className={`px-3 py-1 text-sm rounded ${
                          viewMode === 'table'
                            ? 'bg-blue-100 text-blue-700'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Table
                      </button>
                    </div>

                    {/* Export Button */}
                    <button
                      onClick={handleExport}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                      Export CSV
                    </button>
                  </div>
                </div>
              </div>

              {/* Business Results */}
              <BusinessResults
                businesses={searchMutation.data.businesses}
                viewMode={viewMode}
                isLoading={false}
              />
            </motion.div>
          )}

          {searchMutation.error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-20"
            >
              <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Search Failed
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {(searchMutation.error as any)?.message || 'Something went wrong. Please try again.'}
              </p>
              <button
                onClick={() => searchMutation.reset()}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </motion.div>
          )}

          {!searchMutation.data && !searchMutation.isPending && !searchMutation.error && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <MagnifyingGlassIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Ready to Search
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                Enter a UK location and select trade types to find verified construction professionals.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default SearchInterface;