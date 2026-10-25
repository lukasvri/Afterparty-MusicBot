import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  plugins: [
    sveltekit({
      adapter: adapter(),
      appDir: 'afterparty-app',
      files: { assets: '../../public' },
      csrf: { trustedOrigins: [] },
    }),
  ],
  server: {
    fs: { allow: ['../..'] },
  },
});
