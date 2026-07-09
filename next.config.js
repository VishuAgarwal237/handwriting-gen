/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" }
  },
  // pdfjs-dist (used server-side to locate questions on the homework PDF) does a
  // runtime `require('canvas')` we don't need for text extraction. sharp is a
  // native module used by the image-based blank detector. Keep all three out of
  // the bundle so the native deps don't break the build.
  serverExternalPackages: ["pdfjs-dist", "canvas", "sharp"]
};

module.exports = nextConfig;
