import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          600: '#3a5aa8',
          700: '#2f4a8a',
        },
      },
    },
  },
  plugins: [],
};
export default config;
