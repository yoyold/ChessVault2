import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' => runs unchanged on GitHub Pages, Cloudflare Pages, Netlify or locally.
export default defineConfig({
  base: './',
  plugins: [react()],
});
