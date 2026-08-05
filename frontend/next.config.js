/** @type {import('next').NextConfig} */

// When deploying under a sub-path (e.g. https://host/bootcamp) set
// NEXT_PUBLIC_BASE_PATH=/bootcamp at build time. Left empty for local dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  // basePath must be omitted (not '') when serving from the root.
  ...(basePath ? { basePath } : {}),
};

module.exports = nextConfig;
