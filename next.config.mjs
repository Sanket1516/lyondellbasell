/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / worker-based packages stay as plain Node requires on the server.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "tesseract.js", "sharp", "@napi-rs/canvas", "pdfkit"],
  webpack(config, { isServer }) {
    // pdf.js optionally requires node-canvas; the browser build never needs it.
    if (!isServer) config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};
export default nextConfig;
