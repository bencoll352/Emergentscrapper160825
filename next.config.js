/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Optimize images
  images: {
    domains: ['maps.googleapis.com', 'lh3.googleusercontent.com'],
    formats: ['image/webp', 'image/avif'],
  },

  // Performance optimizations
  experimental: {
    optimizeCss: true,
    optimizePackageImports: ['@heroicons/react', 'framer-motion'],
  },

  // Compress responses
  compress: true,

  // Bundle analyzer for production builds
  webpack: (config, { isServer, dev }) => {
    // Optimize bundle size
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              chunks: 'all',
              priority: 10
            },
            firebase: {
              test: /[\\/]node_modules[\\/]firebase[\\/]/,
              name: 'firebase',
              chunks: 'all',
              priority: 20
            },
            ui: {
              test: /[\\/]src[\\/](components|ui)[\\/]/,
              name: 'ui',
              chunks: 'all',
              priority: 30
            }
          }
        }
      };
    }

    return config;
  },

  // Environment variables
  env: {
    CUSTOM_KEY: process.env.NODE_ENV,
  },

  // Headers for security and performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Static file caching
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'production' 
          ? 'https://your-functions-url/api/:path*'
          : 'http://localhost:5001/your-project/europe-west2/api/:path*'
      }
    ];
  },

  // Redirects for SEO
  async redirects() {
    return [
      {
        source: '/search',
        destination: '/',
        permanent: true,
      },
    ];
  },

  // Output config for Firebase hosting
  output: 'export',
  trailingSlash: true,
  distDir: 'out',
};

module.exports = nextConfig;