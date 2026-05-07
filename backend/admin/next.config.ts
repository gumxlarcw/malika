/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/backend",
  output: "standalone",
  turbopack: {
    root: __dirname   // menghilangkan warning workspace root
  }
};

module.exports = nextConfig;
