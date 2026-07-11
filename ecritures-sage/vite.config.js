import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Chemins relatifs : fonctionne à la racine d'un domaine comme sous un
  // sous-chemin (GitHub Pages, etc.).
  base: './',
  plugins: [react()]
});
