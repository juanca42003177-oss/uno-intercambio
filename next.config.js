const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_COMMISSION_ADDRESS: process.env.NEXT_PUBLIC_COMMISSION_ADDRESS,
    NEXT_PUBLIC_POLYGON_ADDRESS: process.env.NEXT_PUBLIC_POLYGON_ADDRESS,
  },
};

module.exports = nextConfig;
