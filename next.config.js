/** @type {import('next').NextConfig} */
const nextConfig = {
  // /home was renamed to /environment; send old links to Studio.
  async redirects() {
    return [{ source: "/home", destination: "/studio", permanent: false }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
