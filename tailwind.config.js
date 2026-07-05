/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf8f0',
          100: '#f9edd8',
          200: '#f2d9ae',
          300: '#e9bf7a',
          400: '#dfa04a',
          500: '#d18628',
          600: '#b96d1e',
          700: '#94531b',
          800: '#78431c',
          900: '#63381a',
          950: '#381c0b'
        }
      }
    }
  },
  plugins: []
};
