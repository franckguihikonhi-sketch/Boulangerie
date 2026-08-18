import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Chemins relatifs : l'app fonctionne à la racine d'un domaine comme sous un
  // sous-chemin (GitHub Pages / Cloudflare Pages).
  base: './',
  plugins: [react()],
  test: {
    // Voir test-setup.js : polyfill WebSocket minimal pour les runners CI
    // encore en Node 20 (le SupabaseClient l'exige à l'instanciation).
    setupFiles: ['./src/test-setup.js']
  }
});
