import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Chemins relatifs : l'app fonctionne aussi bien à la racine d'un domaine
  // que sous un sous-chemin (GitHub Pages : /Boulangerie/).
  base: './',
  plugins: [react()],
});
