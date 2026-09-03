const nextConfig = {
  output: 'standalone',
  // Lets the test harness build into its own directory (NEXT_DIST_DIR=.next-test) so a test
  // run can't clobber the build cache of a dev server already running from this folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: [
    'roblox-market-24.preview.emergentagent.com',
    'roblox-market-24.cluster-5.preview.emergentcf.cloud',
    '*.preview.emergentagent.com',
    '*.emergentagent.com',
    '*.emergentcf.cloud',
    '*.trycloudflare.com',
  ],
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/**' },
    ],
  },
  // Renamed from experimental.serverComponentsExternalPackages in Next 15
  serverExternalPackages: ['mongodb'],
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
