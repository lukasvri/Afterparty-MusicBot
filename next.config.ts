import type { NextConfig } from 'next';
import { standaloneFramePolicy } from './lib/frame-policy.ts';

// The request-time worker applies Activity document exceptions after framework
// matching. Keep this baseline restrictive, including development/fallback hosts.
const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: standaloneFramePolicy },
    ] }];
  },
};
export default nextConfig;
