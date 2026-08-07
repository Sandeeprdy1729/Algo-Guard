/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const api = process.env.AGENTGUARD_SERVER ?? 'http://localhost:4021';
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/stream', destination: `${api}/api/stream` },
    ];
  },
};
export default nextConfig;
