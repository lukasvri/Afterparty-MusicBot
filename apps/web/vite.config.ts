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
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self', 'https://www.youtube.com', 'https://s.ytimg.com'],
          // Player geometry and Svelte transitions use element style attributes.
          'style-src': ['self'],
          'style-src-attr': ['unsafe-inline'],
          'img-src': ['self', 'https:', 'data:', 'blob:'],
          'media-src': ['self', 'https:', 'blob:'],
          'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
          'base-uri': ['self'],
          'object-src': ['none'],
          'frame-ancestors': ['none'],
          'form-action': ['self'],
        },
      },
    }),
  ],
  server: {
    fs: { allow: ['../..'] },
  },
});
