import React, { Suspense } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

// Dynamic imports for code splitting
const SearchInterface = dynamic(() => import('@/components/SearchInterface'), {
  ssr: false,
  loading: () => <LoadingSpinner />
});

// React Query client with optimized configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: (failureCount, error: any) => {
        // Don't retry on client errors (4xx)
        if (error?.statusCode >= 400 && error?.statusCode < 500) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false,
    },
  },
});

const Home: NextPage = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
        <Head>
          <title>UK Trade Contact Intelligence | Find Construction Professionals</title>
          <meta 
            name="description" 
            content="Find verified construction and trade professionals across the UK. Enhanced with Companies House data for business verification." 
          />
          <meta name="keywords" content="UK trades, construction professionals, builders, electricians, plumbers, carpenters" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          
          {/* Open Graph */}
          <meta property="og:title" content="UK Trade Contact Intelligence" />
          <meta property="og:description" content="Find verified construction and trade professionals across the UK" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://your-domain.com" />
          
          {/* Performance hints */}
          <link rel="dns-prefetch" href="//maps.googleapis.com" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          
          {/* Progressive Web App */}
          <meta name="theme-color" content="#3b82f6" />
          <link rel="manifest" href="/manifest.json" />
          
          {/* Favicon */}
          <link rel="icon" href="/favicon.ico" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        </Head>

        <ErrorBoundary>
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
              <LoadingSpinner size="large" />
            </div>
          }>
            <SearchInterface />
          </Suspense>
        </ErrorBoundary>

        {/* Toast notifications */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fff',
              color: '#333',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />

        {/* React Query DevTools (development only) */}
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </div>
    </QueryClientProvider>
  );
};

export default Home;