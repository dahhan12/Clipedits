/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only heavy deps out of the client bundle.
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "playwright"],
};

export default nextConfig;
