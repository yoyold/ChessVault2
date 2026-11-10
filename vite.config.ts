import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' => läuft unverändert auf GitHub Pages, Cloudflare Pages, Netlify oder lokal.
export default defineConfig({
  base: './',
  plugins: [react()],
});
