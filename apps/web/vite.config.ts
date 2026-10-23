import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { defineConfig } from 'vite';

export default defineConfig({
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
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/fonts': 'http://127.0.0.1:8787',
      '/afterparty-mark.svg': 'http://127.0.0.1:8787',
      '/favicon.svg': 'http://127.0.0.1:8787',
    },
  },
});
